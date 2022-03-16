import * as anchor from "@project-serum/anchor";
import { BN, web3, Program, ProgramError, Provider } from "@project-serum/anchor";
import { EnrexStake } from "../target/types/enrex_stake";
import { TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";

import {
  initProgram,
  createState,
  createPool,
  fundPool,
  withdraw,
  stake,
  claim,
  cancelStake,
  getStatePda,
  getPoolPda,
  getNewStakeInfoAccountPda,
  getLamport,
  createMint,
  getPools,
  getStakes
} from "./api";
import { sleep } from "@project-serum/common";

const { SystemProgram, Keypair, Transaction } = anchor.web3
const assert = require("assert");

const utf8 = anchor.utils.bytes.utf8;
anchor.setProvider(anchor.Provider.env());
const provider = anchor.getProvider();
let providerWalletKey = provider.wallet.publicKey;

const program = anchor.workspace.EnrexStake as Program<EnrexStake>;
const connection = provider.connection;

let mintA:Token,
stateSigner:web3.PublicKey,
poolSigner:web3.PublicKey,
poolVault: web3.PublicKey,
userVault: web3.PublicKey,
adminVault: web3.PublicKey,
stakeInfoPda: web3.PublicKey;

let decimals: number = 9;

describe("enrex_stake", () => {
  // Configure the client to use the local cluster.

  const user = Keypair.generate();
  const userWallet = new anchor.Wallet(user);

  it("Is initialized!", async () => {
    // Add your test here.
    // const tx = await program.rpc.initialize({});
    // console.log("Your transaction signature", tx);

    mintA = await createMint(provider, providerWalletKey);
    decimals = (await mintA.getMintInfo()).decimals;

    console.log('mintA', mintA.publicKey.toString());
    console.log('decimals = ', decimals);

    userVault = await mintA.createAccount(user.publicKey);
    adminVault = await mintA.createAccount(providerWalletKey);
    await connection.confirmTransaction(await connection.requestAirdrop(user.publicKey, web3.LAMPORTS_PER_SOL));
    await mintA.mintTo(userVault, providerWalletKey, [(provider as any).wallet.payer], 100000 * 10 ** 9);
    await mintA.mintTo(adminVault, providerWalletKey, [(provider as any).wallet.payer], 100000 * 10 ** 9);

    initProgram( connection, provider.wallet, program.programId );

    stateSigner = await getStatePda();
  });

  it("Create State", async () => {
    try {
      const stateInfo = await program.account.stateAccount.fetch(stateSigner);
      console.log('State already exists')
    }
    catch {
      await createState(mintA.publicKey);

      const stateInfo = await program.account.stateAccount.fetch(stateSigner);
      assert(stateInfo.authority.toString() === providerWalletKey.toString(),
        "State Creator is Invalid");
      assert(stateInfo.tokenMint.toString() === mintA.publicKey.toString(),
        "Token Mint from state account mismatch");
    }
  });

  it("Create Pool", async() => {
    let apy1 = 48, apy2 = 60, apy3 = 84;
    let min_stake_amount = 1000;
    let lock_duration1 = new BN(10), lock_duration2 = new BN(60 * 24 * 3600), lock_duration3 = new BN(90 * 24 * 3600);

    let pools = await program.account.farmPoolAccount.all()
    let pool_index = pools.length;
    console.log('pool_index', pool_index)

    await createPool( apy1, min_stake_amount, lock_duration1, mintA.publicKey );
    await createPool( apy2, min_stake_amount, lock_duration2, mintA.publicKey );
    await createPool( apy3, min_stake_amount, lock_duration3, mintA.publicKey );

    poolSigner = await getPoolPda(mintA.publicKey, pool_index);

    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);

    pools = await program.account.farmPoolAccount.all()
    assert(pools.length === 3, "Pool count mismatch");
    assert(poolInfo.lockDuration.eq(lock_duration1), "Lock Duation mismatch");
  });

  it("Fund Reward to the Pool", async() => {
    let amount = 10000;
    try {
      console.log('trying malicious user funding');

      initProgram(connection, userWallet, program.programId);
      await fundPool(
        mintA.publicKey,
        adminVault,
        0,
        amount,
      );
      assert(false, "Failed admin validation in funding!");
    } catch {
      initProgram(connection, provider.wallet, program.programId);
      await fundPool(mintA.publicKey, adminVault, 0, amount );
      await fundPool(mintA.publicKey, adminVault, 1, amount );
      await fundPool(mintA.publicKey, adminVault, 2, amount );

      let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('reward in the pool', poolInfo.amountReward.toNumber() / (10 ** decimals));
    }
  });

  it("Stake", async() => {
    initProgram(connection, userWallet, program.programId);

    let poolInfo = await program.account.farmPoolAccount.fetch( poolSigner );

    stakeInfoPda = await getNewStakeInfoAccountPda( poolSigner );

    try {
      let amount = 100;
      await stake( mintA.publicKey, userVault, 0, amount );
      assert(false, "Failed checking minimum stake amount!");
    } catch {
      console.log("Can not stake less than the minimum set! Trying more...");
      let amount1 = 1001, amount2 = 1002, amount3 = 1003;
      await stake( mintA.publicKey, userVault, 0, amount1 );
      await stake( mintA.publicKey, userVault, 0, amount2 );
      await stake( mintA.publicKey, userVault, 0, amount3 );

      await stake( mintA.publicKey, userVault, 1, amount1 );
      await stake( mintA.publicKey, userVault, 1, amount2 );
      await stake( mintA.publicKey, userVault, 1, amount3 );

      await stake( mintA.publicKey, userVault, 2, amount1 );
      await stake( mintA.publicKey, userVault, 2, amount2 );
      await stake( mintA.publicKey, userVault, 2, amount3 );

      let stakeInfoAccount = await program.account.stakedInfo.fetch(stakeInfoPda);
      console.log('stakeInfoAccount amount', stakeInfoAccount.amount.toNumber() / (10 ** decimals));
      console.log('stakeInfoAccount reward amount', stakeInfoAccount.rewardAmount.toNumber() /  (10 ** decimals));
      console.log('stakeInfoAccount index', stakeInfoAccount.stakeIndex.toString());

      poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('pool rewardAmount', poolInfo.amountReward.toNumber() / (10 ** decimals));
      console.log('pool reserved reward amount', poolInfo.amountRewardReserved.toNumber() / (10 ** decimals));
      console.log('pool stakedAmount', poolInfo.amountStaked.toNumber() / (10 ** decimals));
      assert(poolInfo.amountStaked.eq(getLamport(amount1 + amount2 + amount3)), "Staked amount in poolInfo is wrong!");
    }
  });

  it("Withdraw Reward from the Pool", async() => {
    try {
      initProgram(connection, provider.wallet, program.programId);
      console.log('trying to withdraw larger than available')

      await withdraw(mintA.publicKey, adminVault, 0, 10000);

    } catch {
      console.log('could not withdraw larger than available, trying less...');
      let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('poolInfo reward before withdrawal', poolInfo.amountReward.toNumber() / (10 ** decimals));
      console.log('poolInfo reserved reward before withdrawal', poolInfo.amountRewardReserved.toNumber() / (10 ** decimals));

      await withdraw(mintA.publicKey, adminVault, 0, 9000);

      poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('rewardAmount after withdrawing', poolInfo.amountReward.toNumber() / (10 ** decimals));
      console.log('reserved reward amount after withdrawing', poolInfo.amountRewardReserved.toNumber() / (10 ** decimals));
    }
  });

  it("Claim Reward from the Pool", async() => {
    initProgram(connection, userWallet, program.programId);
    await sleep(10000);
    //should succeed
    await claim(mintA.publicKey, userVault, 0, 0);
    console.log('claim succeeded!');

    //should fail
    await claim(mintA.publicKey, userVault, 1, 0);
  });

  it("Cancel Stake", async() => {
    console.log('before cancelling stake...');
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
    console.log('count stakes = ', poolInfo.countStakes.toNumber());
    console.log('amount', poolInfo.amountStaked.toNumber() / (10 ** decimals));
    console.log('amountReward', poolInfo.amountReward.toNumber() / (10 ** decimals));
    console.log('amountRewardReserved', poolInfo.amountRewardReserved.toNumber() / (10 ** decimals));

    await cancelStake(mintA.publicKey, userVault, 1, 0);
    console.log('after cancelling stake...')
    poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
    console.log('count stakes = ', poolInfo.countStakes.toNumber());
    console.log('amount', poolInfo.amountStaked.toNumber() / (10 ** decimals));
    console.log('amountReward', poolInfo.amountReward.toNumber() / (10 ** decimals));
    console.log('amountRewardReserved', poolInfo.amountRewardReserved.toNumber() / (10 ** decimals));
  });

  it("Get all pools", async() => {
    let pools = await getPools();
    for(let i = 0; i < pools.length; i++) {
      console.log('pools[' + i + ']', pools[i]);
      let stakes = await getStakes(pools[i].publicKey.toString());
      for(let j = 0; j < stakes.length; j++) {
        console.log('stakes[' + j + ']', stakes[j]);
      }
    }
  });

  it("Get all stakes", async() => {
    let stakes = await getStakes();
    for(let i = 0; i < stakes.length; i++) {
      console.log('stakes[' + i + ']', stakes[i]);
    }
  })
});