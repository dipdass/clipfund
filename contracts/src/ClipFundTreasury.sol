// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStockVenue {
    function buy(address stock, uint256 usdcIn, uint256 minOut, address to) external returns (uint256);
    function valueOf(address stock, uint256 amount) external view returns (uint256);
}

/// @title ClipFundTreasury
/// @notice Treasury of an AI agent that sells clipping work for USDC (via x402).
///         Every payment is split by onchain rules:
///           1) Operating reserve is refilled first, up to `reserveTarget`. The agent can ONLY spend the
///              reserve on owner-allowlisted operating-cost payees. It can never be invested.
///           2) Of the surplus, `investBps` (owner-set) goes to the stock budget, the rest stays as USDC cash.
///         The agent may only spend the stock budget, only on owner-allowlisted stock tokens, and a purchase
///         reverts if it would push that stock above its `maxWeightBps` of total treasury NAV.
contract ClipFundTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;

    IERC20 public immutable usdc;
    IStockVenue public venue;
    address public agent;

    // Policy (owner-controlled)
    uint256 public reserveTarget; // USDC (1e6)
    uint16 public investBps;      // share of surplus that goes to stocks

    // Buckets (USDC, 1e6). Invariant: usdc.balanceOf(this) >= reserveBalance + stockBudget + cashBalance
    uint256 public reserveBalance;
    uint256 public stockBudget;
    uint256 public cashBalance;

    // Lifetime stats
    uint256 public totalRevenue;
    uint256 public totalOpex;
    uint256 public totalInvested;
    uint256 public paymentCount;

    struct StockConfig { bool allowed; uint16 maxWeightBps; bool listed; }
    mapping(address => StockConfig) public stocks;
    address[] public stockList;
    mapping(address => bool) public opexPayee;
    mapping(bytes32 => bool) public paymentRecorded;

    event AgentSet(address indexed agent);
    event VenueSet(address indexed venue);
    event PolicySet(uint256 reserveTarget, uint16 investBps);
    event StockSet(address indexed stock, bool allowed, uint16 maxWeightBps);
    event OpexPayeeSet(address indexed payee, bool allowed);
    event PaymentRecorded(bytes32 indexed paymentRef, address indexed payer, uint256 amount, string job);
    event Allocated(bytes32 indexed paymentRef, uint256 toReserve, uint256 toStocks, uint256 toCash);
    event OperatingCostPaid(address indexed payee, uint256 amount, string memo);
    event StockPurchased(address indexed stock, uint256 usdcIn, uint256 stockOut, uint256 weightBpsAfter);
    event CashWithdrawn(address indexed to, uint256 amount);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event StockWithdrawn(address indexed stock, address indexed to, uint256 amount);

    error NotAgent();
    error Duplicate();
    error ExceedsUnaccounted();
    error ExceedsBucket();
    error StockNotAllowed();
    error WeightCap(uint256 weightBps, uint16 maxBps);
    error BadParam();

    modifier onlyAgent() { if (msg.sender != agent) revert NotAgent(); _; }

    constructor(IERC20 usdc_, IStockVenue venue_, address agent_, uint256 reserveTarget_, uint16 investBps_)
        Ownable(msg.sender)
    {
        if (investBps_ > BPS) revert BadParam();
        usdc = usdc_;
        venue = venue_;
        agent = agent_;
        reserveTarget = reserveTarget_;
        investBps = investBps_;
        emit AgentSet(agent_);
        emit VenueSet(address(venue_));
        emit PolicySet(reserveTarget_, investBps_);
    }

    // ---------------- owner policy ----------------
    function setAgent(address a) external onlyOwner { agent = a; emit AgentSet(a); }
    function setVenue(IStockVenue v) external onlyOwner { venue = v; emit VenueSet(address(v)); }

    function setPolicy(uint256 reserveTarget_, uint16 investBps_) external onlyOwner {
        if (investBps_ > BPS) revert BadParam();
        reserveTarget = reserveTarget_;
        investBps = investBps_;
        emit PolicySet(reserveTarget_, investBps_);
    }

    function setStock(address stock, bool allowed, uint16 maxWeightBps) external onlyOwner {
        if (maxWeightBps > BPS || stock == address(0) || stock == address(usdc)) revert BadParam();
        StockConfig storage c = stocks[stock];
        if (!c.listed) { c.listed = true; stockList.push(stock); }
        c.allowed = allowed;
        c.maxWeightBps = maxWeightBps;
        emit StockSet(stock, allowed, maxWeightBps);
    }

    function setOpexPayee(address payee, bool allowed) external onlyOwner {
        opexPayee[payee] = allowed;
        emit OpexPayeeSet(payee, allowed);
    }

    function withdrawCash(address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > cashBalance) revert ExceedsBucket();
        cashBalance -= amount;
        usdc.safeTransfer(to, amount);
        emit CashWithdrawn(to, amount);
    }

    function withdrawReserve(address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > reserveBalance) revert ExceedsBucket();
        reserveBalance -= amount;
        usdc.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    function withdrawStock(address stock, address to, uint256 amount) external onlyOwner nonReentrant {
        if (stock == address(usdc)) revert BadParam();
        IERC20(stock).safeTransfer(to, amount);
        emit StockWithdrawn(stock, to, amount);
    }

    // ---------------- agent actions ----------------

    /// @notice USDC received (e.g. an x402 settlement paid straight to this contract) that no bucket owns yet.
    function unaccounted() public view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        uint256 owned = reserveBalance + stockBudget + cashBalance;
        return bal > owned ? bal - owned : 0;
    }

    /// @notice Book a settled payment and split it by the policy. `paymentRef` = settlement tx hash.
    function recordPayment(bytes32 paymentRef, address payer, uint256 amount, string calldata job)
        external onlyAgent nonReentrant
    {
        if (paymentRecorded[paymentRef]) revert Duplicate();
        if (amount == 0 || amount > unaccounted()) revert ExceedsUnaccounted();
        paymentRecorded[paymentRef] = true;

        uint256 gap = reserveTarget > reserveBalance ? reserveTarget - reserveBalance : 0;
        uint256 toReserve = amount < gap ? amount : gap;
        uint256 surplus = amount - toReserve;
        uint256 toStocks = surplus * investBps / BPS;
        uint256 toCash = surplus - toStocks;

        reserveBalance += toReserve;
        stockBudget += toStocks;
        cashBalance += toCash;
        totalRevenue += amount;
        paymentCount += 1;

        emit PaymentRecorded(paymentRef, payer, amount, job);
        emit Allocated(paymentRef, toReserve, toStocks, toCash);
    }

    /// @notice Operating costs come out of the reserve only, and only to allowlisted payees.
    function payOperatingCost(address payee, uint256 amount, string calldata memo) external onlyAgent nonReentrant {
        if (!opexPayee[payee]) revert BadParam();
        if (amount > reserveBalance) revert ExceedsBucket();
        reserveBalance -= amount;
        totalOpex += amount;
        usdc.safeTransfer(payee, amount);
        emit OperatingCostPaid(payee, amount, memo);
    }

    /// @notice Buy an allowlisted stock using ONLY the stock budget. Reserve and cash are untouchable here.
    function buyStock(address stock, uint256 usdcAmount, uint256 minOut) external onlyAgent nonReentrant returns (uint256 out) {
        StockConfig memory c = stocks[stock];
        if (!c.allowed) revert StockNotAllowed();
        if (usdcAmount == 0 || usdcAmount > stockBudget) revert ExceedsBucket();
        stockBudget -= usdcAmount;
        totalInvested += usdcAmount;

        uint256 balBefore = usdc.balanceOf(address(this));
        usdc.forceApprove(address(venue), usdcAmount);
        out = venue.buy(stock, usdcAmount, minOut, address(this));
        usdc.forceApprove(address(venue), 0);
        // venue must not pull more than approved
        if (balBefore - usdc.balanceOf(address(this)) != usdcAmount) revert BadParam();

        uint256 w = weightBps(stock);
        if (w > c.maxWeightBps) revert WeightCap(w, c.maxWeightBps);
        emit StockPurchased(stock, usdcAmount, out, w);
    }

    // ---------------- views ----------------
    function stockValue(address stock) public view returns (uint256) {
        uint256 bal = IERC20(stock).balanceOf(address(this));
        return bal == 0 ? 0 : venue.valueOf(stock, bal);
    }

    function nav() public view returns (uint256 total) {
        total = usdc.balanceOf(address(this));
        for (uint256 i; i < stockList.length; ++i) total += stockValue(stockList[i]);
    }

    function weightBps(address stock) public view returns (uint256) {
        uint256 n = nav();
        return n == 0 ? 0 : stockValue(stock) * BPS / n;
    }

    function stockCount() external view returns (uint256) { return stockList.length; }
}
