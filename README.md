# enrex-staking-contract

1. Install Solana development environment
    1. Install [Rust](https://doc.rust-lang.org/cargo/getting-started/installation.html)

       ```curl https://sh.rustup.rs -sSf | sh```
    2. Install [Solana v1.9.5 (as of 2/2/2022)](https://docs.solana.com/cli/install-solana-cli-tools)

       ```sh -c "$(curl -sSfL https://release.solana.com/v1.9.5/install)"```
    3. Install [⚓ Anchor](https://project-serum.github.io/anchor/getting-started/installation.html#install-rust)
       ```cargo install --git https://github.com/project-serum/anchor --tag v0.22.0 anchor-cli --locked```

2. Restart terminals (or create new terminal window via CMD+N)

3. Install packages:

   ```yarn install```
<br>

## Configure localnet testing

1. Set Solana CLI config to interact with the localnet (at localhost):

   ```solana config set --url localhost```

1. In a separate terminal tab, run `solana-test-validator`. Leave this window open and it should be running and look something like this:

   ```zsh
   solana-test-validator
   ```
   ![init-validator](./.github/init-validator.png)

1. Build and deploy programs (smart contracts) to determine their addresses:

   ```anchor build && anchor deploy```

    - Copy these addresses into Anchor.toml where it says `enrex_stake = _ADDRESS_`.

    - Additionally, copy those addresses into their respective lib.rs files where it says `declare_id!("_ADDRESS_")`

1. Run tests: `anchor test --skip-build && --skip-deploy`

<br>

## Configure devnet testing

1. Set Solana CLI config to work with the devnet:

   ```solana config set --url devnet```

1. Build and deploy programs (smart contracts):

   ```anchor build && anchor deploy```

   This transaction may fail, saying that there is not enough SOL in your wallet.

     - If so, first copy the address and airdrop to account (ctrl + c to exit the loop):

   ```for i in `seq 1 10`; do solana airdrop 2 _your_address_; done```

     - And deploy again:
       ```anchor deploy```

     - This will output the Program IDs/addresss for the `enrex_stake` program.


1. Copy these addresses into Anchor.toml where it says `enrex_stake = _ADDRESS_`.

     - Additionally, copy those addresses into their respective lib.rs files where it says `declare_id!("_ADDRESS_")`

1. Rebuild and deploy programs/smart contracts again: `anchor build && anchor deploy`