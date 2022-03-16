import { IDL as idl, EnrexStake } from "../target/types/enrex_stake";
let program: anchor.Program<EnrexStake> = null as any;
let programId: anchor.web3.PublicKey = null as any;

// @ts-ignore
import * as anchor from '@project-serum/anchor';
const { BN, web3, Program, Provider } = anchor
import { Account, Connection, PublicKey, TokenAccountsFilter } from '@solana/web3.js';

// @ts-ignore
import { TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";

const defaultAccounts = {
    tokenProgram: TOKEN_PROGRAM_ID,
    clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
}

export const STATE_TAG = Buffer.from("state");
export const STAKE_INFO_TAG = Buffer.from("stake-info");

export interface IResult {
    success: boolean;
    data: any;
    msg: string;
}

export async function getPda(
  seeds: (Buffer | Uint8Array)[],
  programId: anchor.web3.PublicKey
) {
  const [pdaKey] = await anchor.web3.PublicKey.findProgramAddress(
    seeds,
    programId
  );
  return pdaKey;
}

export const getLamport = (amount: number, decimals: number = 9) : anchor.BN => {
	return new BN(amount * 10 ** decimals);
}

export async function createMint (provider, authority, decimals = 9) {
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

//Initialize program upon connecting to wallet
//You can use functions in the api only after calling this function
//Call this function again whenever you're switching the wallet or connecting your wallet again.
export const initProgram = (
	connection: anchor.web3.Connection,
	wallet: any,
	pid: PublicKey
): IResult => {
	let result: IResult = { success: true, data: null, msg: "" };
	try {
		programId = pid;
		const provider = new anchor.Provider(
      connection,
      wallet,
      anchor.Provider.defaultOptions()
    );

    // Generate the program client from IDL.
    program = new (anchor as any).Program(
      idl,
      programId,
      provider
    ) as anchor.Program<EnrexStake>;

		console.log('wallet has changed into', wallet.publicKey.toString())
	} catch(e: any) {
    result.success = false;
    result.msg = e.message;
	} finally {
		return result;
	}
}

export async function getStatePda() {
    const stateKey = await getPda([STATE_TAG], programId);
    return stateKey
}

export async function getPoolPda(
    mint: string | PublicKey,
    pool_index: number
) {
    const poolSigner = await getPda([(new PublicKey(mint)).toBuffer(), Buffer.from([pool_index])], programId);
    return poolSigner;
}

export async function getPoolVault(
    mint: string | anchor.web3.PublicKey,
    pool_signer: string | anchor.web3.PublicKey
) {
    const poolVault = await getPda(
			[new PublicKey(mint).toBuffer(), new PublicKey(pool_signer).toBuffer()],
      programId
    );
    return poolVault;
}

export async function getNewStakeInfoAccountPda(
	pool_pda: string | PublicKey
) {
	let poolInfo = await program.account.farmPoolAccount.fetch(pool_pda);


	const [stakeInfoPda] = await anchor.web3.PublicKey.findProgramAddress(
		[
			STAKE_INFO_TAG,
			new PublicKey(pool_pda).toBuffer(),
			program.provider.wallet.publicKey.toBuffer(),
			poolInfo.incStakes.toBuffer("be", 8)
		],
		program.programId
	);

	console.log('incStakes', poolInfo.incStakes.toNumber())
	console.log('stakedInfo', stakeInfoPda.toString())
	return stakeInfoPda;
}

export async function getStakeInfoAccountPdaByIndex(
	pool_pda: string | PublicKey,
	stake_index: number
) {
	let poolInfo = await program.account.farmPoolAccount.fetch(pool_pda);


	const [stakeInfoPda] = await anchor.web3.PublicKey.findProgramAddress(
		[
			STAKE_INFO_TAG,
			new PublicKey(pool_pda).toBuffer(),
			program.provider.wallet.publicKey.toBuffer(),
			new BN(stake_index).toBuffer("be", 8)
		],
		program.programId
	);

	console.log('incStakes', poolInfo.incStakes.toNumber())
	console.log('stakedInfo', stakeInfoPda.toString())
	return stakeInfoPda;
}

export async function createState(
    mint: string | PublicKey
) {
    let stateSigner = await getStatePda();

    await program.rpc.createState({
        accounts: {
          state: stateSigner,
          tokenMint: mint,
          authority: program.provider.wallet.publicKey,
          ...defaultAccounts
        }
      });
}

export async function createPool(
    apy: number,
    min_stake_amount: number,
    lock_duration: anchor.BN,
    mint: string | PublicKey
) {
    let stateSigner = await getStatePda();

    let pools = await program.account.farmPoolAccount.all()
    let pool_index = pools.length;
    let poolSigner = await getPoolPda(mint, pool_index);

    const poolVault = await getPda(
			[new PublicKey(mint).toBuffer(), poolSigner.toBuffer()],
			programId
		);

    await program.rpc.createPool(
        pool_index,
        apy,
        getLamport(min_stake_amount, 9),
        lock_duration,
        {
            accounts:{
                pool: poolSigner,
                state: stateSigner,
                vault: poolVault,
                mint: mint,
                authority: program.provider.wallet.publicKey,
                ...defaultAccounts
            }
        }
    );
}

export async function fundPool(
    mint: anchor.web3.PublicKey,
    vault: anchor.web3.PublicKey,
    pool_index: number,
    amount: number
) {
    let stateSigner = await getStatePda();
    let poolSigner = await getPoolPda(mint, pool_index);
    let poolVault = await getPoolVault(mint, poolSigner);

    const tx = await program.transaction.fundPool(getLamport(amount, 9),
    {
      accounts: {
        state: stateSigner,
        pool: poolSigner,
        authority: program.provider.wallet.publicKey,
        poolVault: poolVault,
        userVault: vault,
        ...defaultAccounts
      }
    });

    const user_provider = new anchor.Provider(
      program.provider.connection,
      program.provider.wallet,
      { commitment: 'confirmed' }
    );

    const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

export async function withdraw(
    mint: anchor.web3.PublicKey,
    vault: anchor.web3.PublicKey,
    pool_index: number,
    amount: number
) {
    let stateSigner = await getStatePda();
    let poolSigner = await getPoolPda(mint, pool_index);
    let poolVault = await getPoolVault(mint, poolSigner);

    const tx = await program.transaction.withdrawPool(getLamport(amount, 9),
    {
      accounts: {
        state: stateSigner,
        pool: poolSigner,
        authority: program.provider.wallet.publicKey,
        poolVault: poolVault,
        userVault: vault,
        ...defaultAccounts
      }
    });
    const user_provider = new anchor.Provider(
      program.provider.connection,
      program.provider.wallet,
      { commitment: 'confirmed' }
    );

    const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

export async function stake(
    mint: anchor.web3.PublicKey,
    user_vault: anchor.web3.PublicKey,
    pool_index: number,
    amount
) {

    let stateSigner = await getStatePda();
    let poolSigner = await getPoolPda(mint, pool_index);
    let poolVault = await getPoolVault(mint, poolSigner);
    let stakeInfo = await getNewStakeInfoAccountPda( poolSigner );

    const tx = await program.transaction.stake(getLamport( amount, 9 ),
    {
      accounts: {
        stakedInfo: stakeInfo,
        state: stateSigner,
        pool: poolSigner,
        authority: program.provider.wallet.publicKey,
        poolVault: poolVault,
        userVault: user_vault,
        ...defaultAccounts
      }
    });
    const user_provider = new anchor.Provider(program.provider.connection, program.provider.wallet, { commitment: 'confirmed' });

    const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
    // return await connection.getTransaction(hash);
}

export async function claim(
  mint: anchor.web3.PublicKey,
  user_vault: anchor.web3.PublicKey,
  pool_index: number,
  stake_index: number
) {
    //check if user_vault exists and create
  let stateSigner = await getStatePda();
  let poolSigner = await getPoolPda(mint, pool_index);
  let stakeInfo = await getStakeInfoAccountPdaByIndex( poolSigner, stake_index );
  let poolVault = await getPoolVault(mint, poolSigner);

  const tx = await program.transaction.claimStake(
  {
    accounts: {
      stakedInfo: stakeInfo,
      state: stateSigner,
      pool: poolSigner,
      authority: program.provider.wallet.publicKey,
      poolVault: poolVault,
      userVault: user_vault,
      ...defaultAccounts
    }
  });
  const user_provider = new anchor.Provider(
    program.provider.connection,
    program.provider.wallet,
    { commitment: 'confirmed' }
  );

  const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

export async function cancelStake(
  mint: anchor.web3.PublicKey,
  user_vault: anchor.web3.PublicKey,
  pool_index: number,
  stake_index: number
) {

  let stateSigner = await getStatePda();
  let poolSigner = await getPoolPda(mint, pool_index);
  let stakeInfo = await getStakeInfoAccountPdaByIndex( poolSigner, stake_index );
  let poolVault = await getPoolVault(mint, poolSigner);

  const tx = await program.transaction.cancelStake(
  {
    accounts: {
      stakedInfo: stakeInfo,
      state: stateSigner,
      pool: poolSigner,
      authority: program.provider.wallet.publicKey,
      poolVault: poolVault,
      userVault: user_vault,
      ...defaultAccounts
    }
  });

  const user_provider = new anchor.Provider(
    program.provider.connection,
    program.provider.wallet,
    { commitment: 'confirmed' }
  );

  const hash = await user_provider.send(tx, [], { commitment: 'confirmed' });
}

export async function getPools() {
  let pools = await program.account.farmPoolAccount.all();
  return pools;
}

export async function getStakes(pool_pda: string = null, user_vault: string = null) {
  let stakes = await program.account.stakedInfo.all();
  return stakes.filter(function(el) {
    let result = true;
    if(pool_pda !== null)
      result = result && (el.account.pool.toString() == pool_pda)
    if(user_vault !== null)
      result = result && (el.account.authority.toString() == user_vault)
    return result;
  })
}