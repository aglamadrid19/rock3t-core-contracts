const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const RocketToken = artifacts.require('RocketToken');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const SlidingWindowOracle = artifacts.require('SlidingWindowOracle');
const FeeApprover = artifacts.require('FeeApprover');

contract('uniswap oracle', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const liquidVault = accounts[1];
  const baseUnit = bn('1000000000000000000');
  const startTime = Math.floor(Date.now() / 1000);

  const defaultWindowSize = 86400 // 24 hours
  const defaultGranularity = 24 // 1 hour each

  const ethFee = 0;
  const feeReceiver = accounts[8];

  let uniswapOracle;
  let uniswapPair;
  let uniswapFactory;
  let uniswapRouter;
  let weth;

  let rocketToken;
  let feeApprover;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    // deploy and setup main contracts
    feeApprover = await FeeApprover.new();
    rocketToken = await RocketToken.new(feeReceiver, feeApprover.address, uniswapRouter.address, uniswapFactory.address);
    uniswapPair = await rocketToken.tokenUniswapPair();
    uniswapOracle = await SlidingWindowOracle.new(uniswapFactory.address, defaultWindowSize, defaultGranularity);
    
    await feeApprover.initialize(rocketToken.address, uniswapFactory.address, uniswapRouter.address, liquidVault);
    await feeApprover.unPause();
    await feeApprover.setFeeMultiplier(0);

    const liquidityTokensAmount = bn('10').mul(baseUnit);
    const liquidityEtherAmount = bn('5').mul(baseUnit);

    await rocketToken.approve(uniswapRouter.address, liquidityTokensAmount);
    await uniswapRouter.addLiquidityETH(
      rocketToken.address,
      liquidityTokensAmount,
      0,
      0,
      OWNER,
      new Date().getTime() + 3000,
      {value: liquidityEtherAmount}
    );

    await ganache.snapshot();
  });
  describe('oracle flow', () => {
    beforeEach('adds prices', async () => {
      const pair = await IUniswapV2Pair.at(uniswapPair);
      const previousBlockTimestamp = (await pair.getReserves())[2]
      
      await uniswapOracle.update(weth.address, rocketToken.address)

      const blockTimestamp = Number(previousBlockTimestamp) + 23 * 3600
      await ganache.setTime(blockTimestamp.toString());

      await uniswapOracle.update(weth.address, rocketToken.address);
    });

    it('updates & consults R3T price', async () => {
      const price = await uniswapOracle.consult(rocketToken.address, bn('100'), weth.address);
      assertBNequal(price, bn('50'));
    })
  });
});