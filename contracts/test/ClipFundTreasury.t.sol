// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClipFundTreasury, IStockVenue} from "../src/ClipFundTreasury.sol";
import {SimStockToken, SimStockExchange} from "../src/SimStock.sol";

contract TestUSDC is ERC20 {
    constructor() ERC20("Test USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract ClipFundTreasuryTest is Test {
    TestUSDC usdc;
    SimStockExchange ex;
    SimStockToken coin;
    SimStockToken nvda;
    SimStockToken rogue;
    ClipFundTreasury t;
    address owner = address(this);
    address agent = makeAddr("agent");
    address payer = makeAddr("payer");
    address vendor = makeAddr("gpuVendor");

    uint256 constant USD = 1e6;

    function setUp() public {
        usdc = new TestUSDC();
        ex = new SimStockExchange(IERC20(address(usdc)));
        coin = new SimStockToken("Coinbase (SIMULATED)", "sCOIN", address(ex));
        nvda = new SimStockToken("NVIDIA (SIMULATED)", "sNVDA", address(ex));
        rogue = new SimStockToken("Rogue (SIMULATED)", "sROGUE", address(ex));
        ex.setPrice(address(coin), 250 * USD);
        ex.setPrice(address(nvda), 160 * USD);
        ex.setPrice(address(rogue), 1 * USD);
        // reserve target 2 USDC, 50% of surplus to stocks
        t = new ClipFundTreasury(IERC20(address(usdc)), IStockVenue(address(ex)), agent, 2 * USD, 5000);
        t.setStock(address(coin), true, 4000);
        t.setStock(address(nvda), true, 4000);
        t.setOpexPayee(vendor, true);
    }

    function _pay(bytes32 ref, uint256 amount) internal {
        usdc.mint(address(t), amount); // simulates x402 transferWithAuthorization to the treasury
        vm.prank(agent);
        t.recordPayment(ref, payer, amount, "clip");
    }

    function _assertBooks() internal view {
        assertEq(usdc.balanceOf(address(t)), t.reserveBalance() + t.stockBudget() + t.cashBalance() + t.unaccounted());
    }

    function test_reserveFillsFirst() public {
        _pay("p1", 1 * USD);
        assertEq(t.reserveBalance(), 1 * USD);
        assertEq(t.stockBudget(), 0);
        assertEq(t.cashBalance(), 0);
        _pay("p2", 3 * USD); // 1 tops reserve to 2, surplus 2 -> 1 stocks, 1 cash
        assertEq(t.reserveBalance(), 2 * USD);
        assertEq(t.stockBudget(), 1 * USD);
        assertEq(t.cashBalance(), 1 * USD);
        assertEq(t.totalRevenue(), 4 * USD);
        assertEq(t.paymentCount(), 2);
        _assertBooks();
    }

    function test_emitsAllocation() public {
        usdc.mint(address(t), 5 * USD);
        vm.expectEmit(true, true, false, true);
        emit ClipFundTreasury.PaymentRecorded("p1", payer, 5 * USD, "clip");
        vm.expectEmit(true, false, false, true);
        emit ClipFundTreasury.Allocated("p1", 2 * USD, 1_500_000, 1_500_000);
        vm.prank(agent);
        t.recordPayment("p1", payer, 5 * USD, "clip");
    }

    function test_reserveCannotBeInvested() public {
        _pay("p1", 2 * USD); // all to reserve
        vm.prank(agent);
        vm.expectRevert(ClipFundTreasury.ExceedsBucket.selector);
        t.buyStock(address(coin), 1, 0);
    }

    function test_cannotInvestBeyondBudget() public {
        _pay("p1", 6 * USD); // reserve 2, stocks 2, cash 2
        vm.prank(agent);
        vm.expectRevert(ClipFundTreasury.ExceedsBucket.selector);
        t.buyStock(address(coin), 2 * USD + 1, 0);
    }

    function test_buyStockWithinCap() public {
        _pay("p1", 10 * USD); // reserve 2, stocks 4, cash 4; nav 10
        vm.prank(agent);
        uint256 out = t.buyStock(address(coin), 2 * USD, 0); // 20% of NAV
        assertEq(out, 2 * USD * 1e8 / (250 * USD));
        assertEq(coin.balanceOf(address(t)), out);
        assertEq(t.stockBudget(), 2 * USD);
        assertEq(t.totalInvested(), 2 * USD);
        assertEq(t.reserveBalance(), 2 * USD);
        assertApproxEqAbs(t.weightBps(address(coin)), 2000, 1);
        assertApproxEqAbs(t.nav(), 10 * USD, 2);
        _assertBooks();
    }

    function test_weightCapReverts() public {
        t.setPolicy(2 * USD, 10000); // all surplus to stocks
        _pay("p1", 10 * USD); // reserve 2, stocks 8
        vm.prank(agent);
        vm.expectRevert(); // 50% > 40% cap
        t.buyStock(address(coin), 5 * USD, 0);
        vm.prank(agent);
        t.buyStock(address(coin), 4 * USD, 0); // 40% ok
        vm.prank(agent);
        t.buyStock(address(nvda), 4 * USD, 0);
        assertEq(t.stockBudget(), 0);
        assertEq(t.reserveBalance(), 2 * USD);
    }

    function test_notAllowlistedReverts() public {
        _pay("p1", 10 * USD);
        vm.prank(agent);
        vm.expectRevert(ClipFundTreasury.StockNotAllowed.selector);
        t.buyStock(address(rogue), 1 * USD, 0);
        t.setStock(address(coin), false, 4000);
        vm.prank(agent);
        vm.expectRevert(ClipFundTreasury.StockNotAllowed.selector);
        t.buyStock(address(coin), 1 * USD, 0);
    }

    function test_onlyAgentAndOwner() public {
        usdc.mint(address(t), 5 * USD);
        vm.prank(payer);
        vm.expectRevert(ClipFundTreasury.NotAgent.selector);
        t.recordPayment("p1", payer, 5 * USD, "clip");
        vm.startPrank(agent);
        vm.expectRevert();
        t.setPolicy(0, 10000);
        vm.expectRevert();
        t.setStock(address(rogue), true, 10000);
        vm.expectRevert();
        t.withdrawReserve(agent, 1);
        vm.expectRevert();
        t.withdrawCash(agent, 1);
        vm.stopPrank();
    }

    function test_duplicateAndPhantomPayments() public {
        _pay("p1", 1 * USD);
        usdc.mint(address(t), 1 * USD);
        vm.startPrank(agent);
        vm.expectRevert(ClipFundTreasury.Duplicate.selector);
        t.recordPayment("p1", payer, 1 * USD, "clip");
        vm.expectRevert(ClipFundTreasury.ExceedsUnaccounted.selector);
        t.recordPayment("p2", payer, 2 * USD, "clip"); // more than actually arrived
        t.recordPayment("p2", payer, 1 * USD, "clip");
        vm.stopPrank();
    }

    function test_opexOnlyFromReserveToPayee() public {
        _pay("p1", 6 * USD); // reserve 2
        vm.startPrank(agent);
        vm.expectRevert(ClipFundTreasury.BadParam.selector);
        t.payOperatingCost(agent, 1 * USD, "self-pay");
        vm.expectRevert(ClipFundTreasury.ExceedsBucket.selector);
        t.payOperatingCost(vendor, 2 * USD + 1, "too much");
        t.payOperatingCost(vendor, 1 * USD, "gpu minutes");
        vm.stopPrank();
        assertEq(usdc.balanceOf(vendor), 1 * USD);
        assertEq(t.reserveBalance(), 1 * USD);
        assertEq(t.totalOpex(), 1 * USD);
        _pay("p2", 1 * USD); // refills reserve first
        assertEq(t.reserveBalance(), 2 * USD);
        assertEq(t.stockBudget(), 2 * USD);
        _assertBooks();
    }

    function test_ownerWithdrawals() public {
        _pay("p1", 6 * USD);
        vm.expectRevert(ClipFundTreasury.ExceedsBucket.selector);
        t.withdrawCash(owner, 2 * USD + 1);
        t.withdrawCash(owner, 2 * USD);
        t.withdrawReserve(owner, 2 * USD);
        assertEq(usdc.balanceOf(owner), 4 * USD);
        assertEq(t.stockBudget(), 2 * USD);
        _assertBooks();
    }

    function test_badPolicy() public {
        vm.expectRevert(ClipFundTreasury.BadParam.selector);
        t.setPolicy(1, 10001);
        vm.expectRevert(ClipFundTreasury.BadParam.selector);
        t.setStock(address(usdc), true, 1000);
    }

    function testFuzz_splitConserves(uint96 a, uint96 b, uint16 bps, uint64 target) public {
        bps = uint16(bound(bps, 0, 10000));
        uint256 x = bound(a, 1, 1e15);
        uint256 y = bound(b, 1, 1e15);
        t.setPolicy(target, bps);
        _pay("a", x);
        _pay("b", y);
        assertEq(t.reserveBalance() + t.stockBudget() + t.cashBalance(), x + y);
        assertLe(t.reserveBalance(), target > x + y ? x + y : target);
        assertEq(t.unaccounted(), 0);
    }
}
