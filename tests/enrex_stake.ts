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

});

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