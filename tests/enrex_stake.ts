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
  createMint
} from "./api";

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

describe("enrex_stake", () => {
  // Configure the client to use the local cluster.

  const user = Keypair.generate();
  const userWallet = new anchor.Wallet(user);

  it("Is initialized!", async () => {
    // Add your test here.
    // const tx = await program.rpc.initialize({});
    // console.log("Your transaction signature", tx);

    mintA = await createMint(provider, providerWalletKey);
    console.log('mintA', mintA.publicKey.toString());
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
    let apy = 48;
    let min_stake_amount = 1000;
    let lock_duration = new BN(30 * 24 * 3600);

    let pools = await program.account.farmPoolAccount.all()
    let pool_index = pools.length;
    console.log('pool_index', pool_index)

    await createPool(
      apy,
      min_stake_amount,
      lock_duration,
      mintA.publicKey
    );

    poolSigner = await getPoolPda(mintA.publicKey, pool_index);

    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);

    pools = await program.account.farmPoolAccount.all()
    assert(pools.length === pool_index + 1, "Pool count mismatch");
    assert(poolInfo.lockDuration.eq(lock_duration), "Lock Duation mismatch");
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
      await fundPool(
        mintA.publicKey,
        adminVault,
        0,
        amount,
      );
      let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('reward in the pool', poolInfo.amountReward.toNumber());
    }
  });

  it("Stake", async() => {
    initProgram(connection, userWallet, program.programId);

    let poolInfo = await program.account.farmPoolAccount.fetch( poolSigner );

    stakeInfoPda = await getNewStakeInfoAccountPda( poolSigner );

    try {
      let amount = 100;
      await stake(
        mintA.publicKey,
        userVault,
        0,
        amount
      );

      assert(false, "Failed checking minimum stake amount!");
    } catch {
      console.log("Can not stake less than the minimum set! Trying more...");
      let amount = 1001;
      await stake(
        mintA.publicKey,
        userVault,
        0,
        amount
      );

      let stakeInfoAccount = await program.account.stakedInfo.fetch(stakeInfoPda);
      console.log('stakeInfoAccount amount', stakeInfoAccount.amount.toNumber());
      console.log('stakeInfoAccount reward amount', stakeInfoAccount.rewardAmount.toNumber());
      console.log('stakeInfoAccount index', stakeInfoAccount.stakeIndex.toString());

      poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('pool rewardAmount', poolInfo.amountReward.toString());
      console.log('pool reserved reward amount', poolInfo.amountRewardReserved.toString());
      console.log('pool stakedAmount', poolInfo.amountStaked.toString());
      assert(poolInfo.amountStaked.eq(getLamport(amount)), "Staked amount in poolInfo is wrong!");

    }
  });

  it("Withdraw Reward from the Pool", async() => {
    try {
      initProgram(connection, provider.wallet, program.programId);
      console.log('trying to withdraw larger than available')
      await withdraw(mintA.publicKey, adminVault, 0, 9999);

      assert(false, "Error: withdrew larger than available!");
    } catch {
      console.log('could not withdraw larger than available, trying less...')
      await withdraw(mintA.publicKey, adminVault, 0, 8000);

      let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('rewardAmount after withdrawing', poolInfo.amountReward.toString());
      console.log('reserved reward amount after withdrawing', poolInfo.amountRewardReserved.toString());
    }
  });

  it("Claim Reward from the Pool", async() => {
    initProgram(connection, userWallet, program.programId);

    //should fail
    await claim(mintA.publicKey, userVault, 0, 0);
  });

  it("Cancel Stake", async() => {
    console.log('before cancelling stake...');
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
    console.log('count stakes = ', poolInfo.countStakes.toNumber());
    console.log('amount', poolInfo.amountStaked.toNumber());
    console.log('amountReward', poolInfo.amountReward.toNumber());
    console.log('amountRewardReserved', poolInfo.amountRewardReserved.toNumber());

    await cancelStake(mintA.publicKey, userVault, 0, 0);
    console.log('after cancelling stake...')
    poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
    console.log('count stakes = ', poolInfo.countStakes.toNumber());
    console.log('amount', poolInfo.amountStaked.toNumber());
    console.log('amountReward', poolInfo.amountReward.toNumber());
    console.log('amountRewardReserved', poolInfo.amountRewardReserved.toNumber());
  })
});

