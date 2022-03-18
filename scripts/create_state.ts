import * as anchor from "@project-serum/anchor";

import {
  initProgram,
  createState
} from "../tests/api";

const TOKEN_MINT = '7kmteEaNyVU4DG22s5zWBfyb4FFQxqJejQHYgNAFVeDd';

anchor.setProvider(anchor.Provider.env());
const provider = anchor.getProvider();
const program = anchor.workspace.EnrexStake;
const connection = provider.connection;

async function main() {
  initProgram( connection, provider.wallet, program.programId );

  await createState(TOKEN_MINT);
}

console.log('Running client.');

main().then(() => console.log('Success')).catch(e => console.error(e));