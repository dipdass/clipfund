// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice SIMULATED tokenized stock for TESTNET demos only.
/// Mirrors the shape of Coinbase tokenized stocks on Base mainnet (e.g. COINc / NVDAc, 8 decimals)
/// but represents NO claim on any real share, company or issuer. Only the SimStockExchange can mint.
contract SimStockToken is ERC20 {
    address public immutable minter;
    string public constant DISCLOSURE = "SIMULATION: testnet token, no real shares, not affiliated with any issuer";

    constructor(string memory name_, string memory symbol_, address minter_) ERC20(name_, symbol_) {
        minter = minter_;
    }

    function decimals() public pure override returns (uint8) { return 8; }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "only minter");
        _mint(to, amount);
    }
}

/// @notice SIMULATED exchange + price oracle for TESTNET demos only.
/// Owner posts a price per whole share in USDC (6 decimals). buy() takes USDC and mints SimStockToken at that price.
/// On mainnet this would be replaced by a real venue (DEX / issuer RFQ) and a Chainlink feed.
contract SimStockExchange is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    mapping(address => uint256) public priceUsdc6; // USDC (1e6) per 1 whole share (1e8 units)

    event PriceSet(address indexed stock, uint256 priceUsdc6);
    event Bought(address indexed buyer, address indexed stock, uint256 usdcIn, uint256 stockOut, uint256 priceUsdc6);

    constructor(IERC20 usdc_) Ownable(msg.sender) { usdc = usdc_; }

    function setPrice(address stock, uint256 p) external onlyOwner {
        require(p > 0, "price=0");
        priceUsdc6[stock] = p;
        emit PriceSet(stock, p);
    }

    function quoteOut(address stock, uint256 usdcIn) public view returns (uint256) {
        uint256 p = priceUsdc6[stock];
        require(p > 0, "no price");
        return usdcIn * 1e8 / p;
    }

    /// @return USDC (1e6) value of `amount` stock units (1e8)
    function valueOf(address stock, uint256 amount) external view returns (uint256) {
        uint256 p = priceUsdc6[stock];
        require(p > 0, "no price");
        return amount * p / 1e8;
    }

    function buy(address stock, uint256 usdcIn, uint256 minOut, address to) external returns (uint256 out) {
        out = quoteOut(stock, usdcIn);
        require(out > 0 && out >= minOut, "slippage");
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        SimStockToken(stock).mint(to, out);
        emit Bought(msg.sender, stock, usdcIn, out, priceUsdc6[stock]);
    }
}
