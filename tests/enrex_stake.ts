import * as anchor from "@project-serum/anchor";
import { BN, web3, Program, ProgramError, Provider } from "@project-serum/anchor";

import { EnrexStake } from "../target/types/enrex_stake";
import * as serumCmn from "@project-serum/common";
import { TOKEN_PROGRAM_ID, Token, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as _ from 'lodash'
import { rpc } from "@project-serum/anchor/dist/cjs/utils";
import { min } from "bn.js";
const { SystemProgram, Keypair, Transaction } = anchor.web3
const assert = require("assert");

const utf8 = anchor.utils.bytes.utf8;
const defaultAccounts = {
  tokenProgram: TOKEN_PROGRAM_ID,
  clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
  systemProgram: SystemProgram.programId,
  rent: anchor.web3.SYSVAR_RENT_PUBKEY,
}
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
stakeInfo: web3.PublicKey;

describe("enrex_stake", () => {
  // Configure the client to use the local cluster.


  const user = Keypair.generate();


  it("Is initialized!", async () => {
    // Add your test here.
    // const tx = await program.rpc.initialize({});
    // console.log("Your transaction signature", tx);

    mintA = await createMint(provider, providerWalletKey);
    console.log('mintA', mintA.publicKey.toString());
    [stateSigner] = await anchor.web3.PublicKey.findProgramAddress(
      [utf8.encode('state')],
      program.programId
    );

    userVault = await mintA.createAccount(user.publicKey);
    adminVault = await mintA.createAccount(providerWalletKey);

    // console.log('wallet.payer', (provider as any).wallet);
    await connection.confirmTransaction(
      await connection.requestAirdrop(user.publicKey, web3.LAMPORTS_PER_SOL));

    await mintA.mintTo(userVault, providerWalletKey, [(provider as any).wallet.payer], 100000 * 10 ** 9);
    await mintA.mintTo(adminVault, providerWalletKey, [(provider as any).wallet.payer], 100000 * 10 ** 9);
  });

  it("Create State", async () => {
    console.log('default', defaultAccounts.systemProgram.toString());
    try {
      const stateInfo = await program.account.stateAccount.fetch(stateSigner);
      console.log('State already exists')
    }
    catch {
      await program.rpc.createState({
        accounts: {
          state: stateSigner,
          tokenMint: mintA.publicKey,
          authority: providerWalletKey,
          ...defaultAccounts
        }
      });
      const stateInfo = await program.account.stateAccount.fetch(stateSigner);
      assert(stateInfo.authority.toString() === providerWalletKey.toString(),
        "State Creator is Invalid");
      assert(stateInfo.tokenMint.toString() === mintA.publicKey.toString(),
        "Token Mint from state account mismatch");
    }
  });

  it("Create Pool", async() => {
    let pools = await program.account.farmPoolAccount.all()
    let pool_index = pools.length;
    let apy = 48;
    let min_stake_amount = new BN(1000 * 10 ** 9);
    let lock_duration = new BN(30 * 24 * 3600);

    [poolSigner] = await anchor.web3.PublicKey.findProgramAddress(
      [mintA.publicKey.toBuffer(), Buffer.from([pool_index])],
      program.programId
    );
    console.log('poolSigner', poolSigner.toString());
    [poolVault] = await anchor.web3.PublicKey.findProgramAddress(
      [mintA.publicKey.toBuffer(), poolSigner.toBuffer()],
      program.programId
    );

    await program.rpc.createPool(
      pool_index,
      apy,
      min_stake_amount,
      lock_duration,
      {
        accounts:{
          pool: poolSigner,
          state: stateSigner,
          vault: poolVault,
          mint: mintA.publicKey,
          authority: providerWalletKey,
          ...defaultAccounts
        }
      }
    );

    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
    console.log('minimum stake amount', poolInfo.minStakeAmount.toString());

    pools = await program.account.farmPoolAccount.all()
    assert(pools.length === pool_index + 1, "Pool count mismatch");
    assert(poolInfo.lockDuration.eq(lock_duration), "Lock Duation mismatch");
  });

  it("Fund Reward to the Pool", async() => {
    let amount = 10000;
    await fund(amount);
  });

  it("Stake", async() => {
    const stateInfo = await program.account.stateAccount.fetch(stateSigner);
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);

    [stakeInfo] = await anchor.web3.PublicKey.findProgramAddress(
      [
        utf8.encode('stake-info'),
        poolSigner.toBuffer(),
        user.publicKey.toBuffer(),
        poolInfo.incStakes.toBuffer("be", 8)
      ],
      program.programId
    );

    try{
      let amount = 100;
      await stake(user, amount);

    } catch {
      console.log("Can not stake less than the minimum set! Trying more...");
      let amount = 1001;
      await stake(user, amount);

      let stakeInfoAccount = await program.account.stakedInfo.fetch(stakeInfo);
      console.log('stakeInfoAccount amount', stakeInfoAccount.amount.toString());
      console.log('stakeInfoAccount reward amount', stakeInfoAccount.rewardAmount.toString());
      console.log('stakeInfoAccount index', stakeInfoAccount.stakeIndex.toString());

      let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('pool rewardAmount', poolInfo.amountReward.toString());
      console.log('pool reserved reward amount', poolInfo.amountRewardReserved.toString());
      console.log('pool stakedAmount', poolInfo.amountStaked.toString());
      assert(poolInfo.amountStaked.eq(new BN(amount * 10 ** 9)), "Staked amount in poolInfo is wrong!");

    }
  });

  it("Withdraw Reward from the Pool", async() => {
    try {
      console.log('trying to withdraw larger than available')
      await withdraw(9999);
    } catch {
      console.log('could not withdraw larger than available, trying less...')
      await withdraw(8000);

      let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
      console.log('rewardAmount', poolInfo.amountReward.toString());
      console.log('reserved reward amount', poolInfo.amountRewardReserved.toString());
    }
  });

  it("Claim Reward from the Pool", async() => {
    //should fail
    await claim(user);
  });

  it("Cancel Stake", async() => {
    console.log('before cancelling stake...');
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
    console.log('count stakes = ', poolInfo.countStakes.toNumber());

    await cancelStake(user);
    console.log('after cancelling stake...')
    poolInfo = await program.account.farmPoolAccount.fetch(poolSigner);
    console.log('count stakes = ', poolInfo.countStakes.toNumber());

  })
});

async function fund(amount) {
  const tx = await program.transaction.fundPool(new BN(amount * 10 ** 9),
  {
    accounts: {
      state: stateSigner,
      pool: poolSigner,
      authority: providerWalletKey,
      poolVault: poolVault,
      userVault: adminVault,
      ...defaultAccounts
    }
  });
  const user_provider = new anchor.Provider(
    connection,
    new anchor.Wallet((program.provider.wallet as any).payer),
    { commitment: 'confirmed' }
  );

  const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

async function withdraw(amount) {

  const tx = await program.transaction.withdrawPool(new BN(amount * 10 ** 9),
  {
    accounts: {
      state: stateSigner,
      pool: poolSigner,
      authority: providerWalletKey,
      poolVault: poolVault,
      userVault: adminVault,
      ...defaultAccounts
    }
  });
  const user_provider = new anchor.Provider(
    connection,
    new anchor.Wallet((program.provider.wallet as any).payer),
    { commitment: 'confirmed' }
  );

  const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

async function stake(user, amount) {
  const tx = await program.transaction.stake(new BN(amount * 10 ** 9),
  {
    accounts: {
      stakedInfo: stakeInfo,
      state: stateSigner,
      pool: poolSigner,
      authority: user.publicKey,
      poolVault: poolVault,
      userVault: userVault,
      ...defaultAccounts
    }
  });
  const user_provider = new anchor.Provider(connection, new anchor.Wallet(user), { commitment: 'confirmed' });

  const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
  // return await connection.getTransaction(hash);
}

async function claim(user) {
  const tx = await program.transaction.claimStake(
  {
    accounts: {
      stakedInfo: stakeInfo,
      state: stateSigner,
      pool: poolSigner,
      authority: user.publicKey,
      poolVault: poolVault,
      userVault: userVault,
      ...defaultAccounts
    }
  });
  const user_provider = new anchor.Provider(connection, new anchor.Wallet(user), { commitment: 'confirmed' });

  const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

async function cancelStake(user) {
  const tx = await program.transaction.cancelStake(
  {
    accounts: {
      stakedInfo: stakeInfo,
      state: stateSigner,
      pool: poolSigner,
      authority: user.publicKey,
      poolVault: poolVault,
      userVault: userVault,
      ...defaultAccounts
    }
  });
  const user_provider = new anchor.Provider(connection, new anchor.Wallet(user), { commitment: 'confirmed' });

  const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

async function getTokenAccount (provider, addr) {
  return await serumCmn.getTokenAccount(provider, addr);
}

async function createMint (provider, authority, decimals = 9) {
  if (authority === undefined) {
    authority = provider.wallet.publicKey;
  }
  const mint = await Token.createMint(
    provider.connection,
    provider.wallet.payer,
    authority,
    null,
    decimals,
    TOKEN_PROGRAM_ID
  );
  return mint;
}