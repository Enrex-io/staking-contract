// @ts-ignore
import * as anchor from '@project-serum/anchor';

// @ts-ignore
import * as serumCmn from "@project-serum/common";

import { TOKEN_PROGRAM_ID, Token, } from "@solana/spl-token";
const { BN, web3, Program, Provider } = anchor
const { PublicKey, SystemProgram, Keypair, Transaction } = web3
const utf8 = anchor.utils.bytes.utf8;

const defaultAccounts = {
    tokenProgram: TOKEN_PROGRAM_ID,
    clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
}

import idl_file from '../target/idl/enrex_stake.json';
import { metadata as STAKE_PROJECT_PROGRAM_ID } from '../target/idl/enrex_stake.json';
import { Account, Connection, TokenAccountsFilter } from '@solana/web3.js';

export function getProgram (
    connection: Connection,
    wallet: any
) {
    const provider = new anchor.Provider(
        connection,
        wallet,
        anchor.Provider.defaultOptions(),
    );
    // Generate the program client from IDL.
    const program = new (anchor as any).Program(idl_file, new PublicKey(STAKE_PROJECT_PROGRAM_ID), provider);
    return program;
}

export async function getStateKey() {
    const [stateKey] = await anchor.web3.PublicKey.findProgramAddress(
        [utf8.encode('state')],
        new PublicKey(STAKE_PROJECT_PROGRAM_ID)
        );
    return stateKey
}

export async function getPoolSigner(
    mint: string | anchor.web3.PublicKey,
    pool_index: number
) {
    const [poolSigner] = await anchor.web3.PublicKey.findProgramAddress(
        [(mint as anchor.web3.PublicKey).toBuffer(), Buffer.from([pool_index])],
        new PublicKey(STAKE_PROJECT_PROGRAM_ID)
      );
    return poolSigner;
}

export async function getPoolVault(
    mint: anchor.web3.PublicKey,
    pool_signer: anchor.web3.PublicKey
) {
    const [poolVault] = await anchor.web3.PublicKey.findProgramAddress(
        [mint.toBuffer(), pool_signer.toBuffer()],
        new PublicKey(STAKE_PROJECT_PROGRAM_ID)
      );
    return poolVault;
}

export async function createState(
    connection: Connection,
    wallet: any,
    mint: string | anchor.web3.PublicKey
) {
    const program = await getProgram(connection, wallet);
    let stateSigner = await getStateKey();

    await program.rpc.createState({
        accounts: {
          state: stateSigner,
          tokenMint: mint,
          authority: wallet.publicKey,
          ...defaultAccounts
        }
      });
}

export async function createPool(
    connection: Connection,
    wallet: any,
    apy: number,
    min_stake_amount: number,
    lock_duration: anchor.BN,
    mint: anchor.web3.PublicKey
) {
    const program = await getProgram(connection, wallet);
    let stateSigner = await getStateKey();

    let pools = await program.account.farmPoolAccount.all()
    let pool_index = pools.length;
    let poolSigner = await getPoolSigner(mint, pool_index);

    const [poolVault] = await anchor.web3.PublicKey.findProgramAddress(
        [mint.toBuffer(), poolSigner.toBuffer()],
        program.programId
      );

    await program.rpc.createPool(
        pool_index,
        apy,
        new BN(min_stake_amount * 10 ** 9),
        lock_duration,
        {
            accounts:{
                pool: poolSigner,
                state: stateSigner,
                vault: poolVault,
                mint: mint,
                authority: wallet,
                ...defaultAccounts
            }
        }
    );
}

export async function fundPool(
    connection: Connection,
    wallet: any,
    mint: anchor.web3.PublicKey,
    vault: anchor.web3.PublicKey,
    pool_index: number,
    amount: number
) {
    const program = await getProgram(connection, wallet);
    let stateSigner = await getStateKey();
    let poolSigner = await getPoolSigner(mint, pool_index);
    let poolVault = await getPoolVault(mint, poolSigner);

    const tx = await program.transaction.fundPool(new BN(amount * 10 ** 9),
    {
      accounts: {
        state: stateSigner,
        pool: poolSigner,
        authority: wallet.publicKey,
        poolVault: poolVault,
        userVault: vault,
        ...defaultAccounts
      }
    });
    const user_provider = new anchor.Provider(
      connection,
      wallet,
      { commitment: 'confirmed' }
    );

    const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

export async function withdraw(
    connection: Connection,
    wallet: any,
    mint: anchor.web3.PublicKey,
    vault: anchor.web3.PublicKey,
    pool_index: number,
    amount: number
) {
    const program = await getProgram(connection, wallet);
    let stateSigner = await getStateKey();
    let poolSigner = await getPoolSigner(mint, pool_index);
    let poolVault = await getPoolVault(mint, poolSigner);

    const tx = await program.transaction.withdrawPool(new BN(amount * 10 ** 9),
    {
      accounts: {
        state: stateSigner,
        pool: poolSigner,
        authority: wallet.publicKey,
        poolVault: poolVault,
        userVault: vault,
        ...defaultAccounts
      }
    });
    const user_provider = new anchor.Provider(
      connection,
      wallet,
      { commitment: 'confirmed' }
    );

    const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

export async function stake(
    connection: Connection,
    wallet: any,
    mint: anchor.web3.PublicKey,
    user_vault: anchor.web3.PublicKey,
    pool_index: number,
    amount
) {
    const program = await getProgram(connection, wallet);
    let stateSigner = await getStateKey();
    let stakeInfo = await program.account.stateAccount.fetch(stateSigner);
    let poolSigner = await getPoolSigner(mint, pool_index);
    let poolVault = await getPoolVault(mint, poolSigner);

    const tx = await program.transaction.stake(new BN(amount * 10 ** 9),
    {
      accounts: {
        stakedInfo: stakeInfo,
        state: stateSigner,
        pool: poolSigner,
        authority: wallet.publicKey,
        poolVault: poolVault,
        userVault: user_vault,
        ...defaultAccounts
      }
    });
    const user_provider = new anchor.Provider(connection, wallet, { commitment: 'confirmed' });

    const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
    // return await connection.getTransaction(hash);
}


  export async function claim(
    connection: Connection,
    wallet: any,
    mint: anchor.web3.PublicKey,
    user_vault: anchor.web3.PublicKey,
    pool_index: number
  ) {
    const program = await getProgram(connection, wallet);
    let stateSigner = await getStateKey();
    let stakeInfo = await program.account.stateAccount.fetch(stateSigner);
    let poolSigner = await getPoolSigner(mint, pool_index);
    let poolVault = await getPoolVault(mint, poolSigner);

    const tx = await program.transaction.claimStake(
    {
      accounts: {
        stakedInfo: stakeInfo,
        state: stateSigner,
        pool: poolSigner,
        authority: wallet.publicKey,
        poolVault: poolVault,
        userVault: user_vault,
        ...defaultAccounts
      }
    });
    const user_provider = new anchor.Provider(connection, wallet, { commitment: 'confirmed' });

    const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
  }


  export async function cancelStake(
    connection: Connection,
    wallet: any,
    mint: anchor.web3.PublicKey,
    user_vault: anchor.web3.PublicKey,
    pool_index: number
  ) {
    const program = await getProgram(connection, wallet);
    let stateSigner = await getStateKey();
    let stakeInfo = await program.account.stateAccount.fetch(stateSigner);
    let poolSigner = await getPoolSigner(mint, pool_index);
    let poolVault = await getPoolVault(mint, poolSigner);

    const tx = await program.transaction.cancelStake(
    {
      accounts: {
        stakedInfo: stakeInfo,
        state: stateSigner,
        pool: poolSigner,
        authority: wallet.publicKey,
        poolVault: poolVault,
        userVault: user_vault,
        ...defaultAccounts
      }
    });
    const user_provider = new anchor.Provider(connection, wallet, { commitment: 'confirmed' });

    const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
  }
