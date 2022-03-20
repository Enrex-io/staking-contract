use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use std::mem::size_of;
pub mod error;
use error::*;
pub mod constants;
use constants::*;

declare_id!("9ZmxLBeqLtxzJ2TRg5YdniyCcVuauB3aL3oTVBBK4Z4K");

#[program]
pub mod enrex_stake {
    use super::*;

    pub fn create_state(
        _ctx: Context<CreateState>
    ) -> Result<()> {
        let state = &mut _ctx.accounts.state;
        state.authority = _ctx.accounts.authority.key();
        state.start_time = _ctx.accounts.clock.unix_timestamp;
        state.token_mint = _ctx.accounts.token_mint.key();
        Ok(())
    }

    pub fn create_pool(
        _ctx: Context<CreateFarmPool>,
        pool_index: u8,
        apy: u8,
        min_stake_amount: u64,
        lock_duration:i64
    ) -> Result<()> {
        let pool = &mut _ctx.accounts.pool;
        pool.vault = _ctx.accounts.vault.key();
        pool.authority = _ctx.accounts.authority.key();
        pool.min_stake_amount = min_stake_amount;
        pool.lock_duration = lock_duration;
        pool.apy = apy;
        pool.index = pool_index;

        Ok(())
    }

    pub fn fund_pool(_ctx: Context<FundPool>, amount: u64) -> Result<()> {
        let pool = &mut _ctx.accounts.pool;
        pool.amount_reward += amount;
        let cpi_accounts = Transfer {
            from: _ctx.accounts.user_vault.to_account_info(),
            to: _ctx.accounts.pool_vault.to_account_info(),
            authority: _ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn withdraw_pool(_ctx: Context<FundPool>, amount: u64) -> Result<()> {
        let state = &_ctx.accounts.state;
        let pool = &mut _ctx.accounts.pool;

        require!(
            pool.amount_reward - pool.amount_reward_reserved >= amount,
            ErrorMsg::AlreadyReserved
        );

        pool.amount_reward -= amount;
        let cpi_accounts = Transfer {
            from: _ctx.accounts.pool_vault.to_account_info(),
            to: _ctx.accounts.user_vault.to_account_info(),
            authority: pool.to_account_info(),
        };

        let bump = bump(&[state.token_mint.as_ref(), &[pool.index]]);
        let seeds = &[state.token_mint.as_ref(), &[pool.index], &[bump]];
        let signer = &[&seeds[..]];

        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn stake(_ctx: Context<Stake>, amount: u64) -> Result<()> {
        let pool = &mut _ctx.accounts.pool;

        require!(amount >= pool.min_stake_amount,
            ErrorMsg::BelowMinStakeAmount
        );

        let reward_amount = pool.get_reward_amount(amount) as u64;
        let reward_amount_reserved = pool.amount_reward_reserved + reward_amount;
        require!(reward_amount_reserved <= pool.amount_reward,
            ErrorMsg::OverflowReservedReward
        );

        let staked_info = &mut _ctx.accounts.staked_info;
        staked_info.amount = amount;
        staked_info.staked_time = _ctx.accounts.clock.unix_timestamp;
        staked_info.pool = pool.key();
        staked_info.authority = _ctx.accounts.authority.key();
        staked_info.stake_index = pool.inc_stakes;
        staked_info.reward_amount = reward_amount;

        pool.inc_stakes += 1;
        pool.count_stakes += 1;
        pool.amount_reward_reserved = reward_amount_reserved;
        pool.amount_staked += amount;

        let cpi_accounts = Transfer {
            from: _ctx.accounts.user_vault.to_account_info(),
            to: _ctx.accounts.pool_vault.to_account_info(),
            authority: _ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn cancel_stake(_ctx: Context<Unstake>) -> Result<()> {
        let pool = &mut _ctx.accounts.pool;
        let state = & _ctx.accounts.state;
        let staked_info = &_ctx.accounts.staked_info;
        let amount = staked_info.amount;

        let cpi_accounts = Transfer {
            from: _ctx.accounts.pool_vault.to_account_info(),
            to: _ctx.accounts.user_vault.to_account_info(),
            authority: pool.to_account_info(),
        };

        let bump = bump(&[state.token_mint.as_ref(), &[pool.index]]);
        let seeds = &[state.token_mint.as_ref(), &[pool.index], &[bump]];
        let signer = &[&seeds[..]];

        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        pool.count_stakes -= 1;
        pool.amount_staked -= amount;
        pool.amount_reward_reserved -= staked_info.reward_amount;

        Ok(())
    }

    pub fn claim_stake(_ctx: Context<Unstake>) -> Result<()> {
        let state = &_ctx.accounts.state;
        let pool = &mut _ctx.accounts.pool;
        let staked_info = &_ctx.accounts.staked_info;

        require!(
            staked_info.staked_time
                .checked_add(pool.lock_duration)
                .unwrap()
                <= _ctx.accounts.clock.unix_timestamp,
            ErrorMsg::UnderLocked
        );

        let amount = staked_info.amount + staked_info.reward_amount;

        let cpi_accounts = Transfer {
            from: _ctx.accounts.pool_vault.to_account_info(),
            to: _ctx.accounts.user_vault.to_account_info(),
            authority: pool.to_account_info(),
        };

        let bump = bump(&[state.token_mint.as_ref(), &[pool.index]]);
        let seeds = &[state.token_mint.as_ref(), &[pool.index], &[bump]];
        let signer = &[&seeds[..]];

        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        pool.count_stakes -= 1;
        pool.amount_reward -= staked_info.reward_amount;
        pool.amount_reward_reserved -= staked_info.reward_amount;
        pool.amount_staked -= staked_info.amount;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateState<'info> {
    #[account(
        init,
        seeds = [b"state".as_ref()],
        bump,
        payer = authority,
        space = 8 + size_of::<StateAccount>()
    )]
    pub state: Account<'info, StateAccount>,

    ///pool's token mint
    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,

    pub clock: Sysvar<'info, Clock>,
}

#[account()]
pub struct StateAccount {
    ///state creator
    pub authority: Pubkey,

    ///token mint will be same through all pools
    pub token_mint: Pubkey,

    ///just as additional info
    pub start_time: i64,
}

#[derive(Accounts)]
#[instruction(pool_index: u8)]
pub struct CreateFarmPool<'info> {
    #[account(
        init,
        seeds = [state.token_mint.as_ref(), &[pool_index]],
        bump,
        payer = authority,
        space = 8 + size_of::<FarmPoolAccount>()
    )]
    pub pool: Account<'info, FarmPoolAccount>,

    ///only state creator can create a pool
    #[account(mut, seeds = [b"state".as_ref()], bump, has_one = authority)]
    pub state: Account<'info, StateAccount>,

    ///token account to receive and transfer stakes and rewards
    #[account(
        init,
        token::mint = mint,
        token::authority = pool,
        seeds = [mint.key().as_ref(), pool.key().as_ref()],
        bump,
        payer = authority
    )]
    pub vault: Account<'info, TokenAccount>,

    ///validating if it is a correct mint that are initiated by the state creator
    #[account(constraint = state.token_mint == mint.key())]
    pub mint: Account<'info, Mint>,

    ///pool creator
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,

    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,

    pub clock: Sysvar<'info, Clock>,

    pub rent: Sysvar<'info, Rent>,
}

#[account()]
pub struct FarmPoolAccount {
    ///farm creator
    pub authority: Pubkey,

    pub amount_staked: u64,

    pub amount_reward: u64,

    pub amount_reward_reserved: u64,

    pub min_stake_amount: u64,

    pub vault: Pubkey,

    ///count of active stakes
    pub count_stakes: u64,

    //only increase - it is used to derive unique stake info account(A user creates a new stake info account whenever he stakes)
    pub inc_stakes: u64,

    pub lock_duration: i64,

    ///apy as percentage value
    pub apy: u8,

    ///it is used as a pool_index when deriving a pool's pda
    pub index: u8
}

impl FarmPoolAccount {

    ///calculate reward amount from the stake amount
    pub fn get_reward_amount(&self, amount: u64) -> u128 {
        let apy = self.apy;
        let lock_duration_in_days = u128::from(ACC_PRECISION)
            .checked_div(3600 * 24)
            .unwrap()
            .checked_mul(self.lock_duration as u128)
            .unwrap();
        let percentage = u128::from(lock_duration_in_days)
            .checked_mul(u128::from(apy))
            .unwrap()
            .checked_div(36525)// 365.25 (days) * 100 (%)
            .unwrap();
        u128::from(amount)
        .checked_mul(percentage)
        .unwrap()
        .checked_div(ACC_PRECISION)
        .unwrap()
    }
}

#[derive(Accounts)]
pub struct FundPool<'info> {
    ///only admin can fund the pool
    #[account(mut,
        seeds = [b"state".as_ref()],
        bump,
        has_one = authority)
    ]
    pub state: Account<'info, StateAccount>,

    #[account(mut,
        seeds = [state.token_mint.as_ref(), &[pool.index]],
        bump,
    )]
    pub pool: Account<'info, FarmPoolAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut,
        seeds = [
            state.token_mint.as_ref(),
            pool.key().as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    ///funder's token account should be admin's
    #[account(mut, constraint = user_vault.owner == authority.key())]
    pub user_vault: Account<'info, TokenAccount>,

    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>
}

#[account()]
pub struct StakedInfo {
    ///staked pool
    pub pool: Pubkey,

    ///staker
    pub authority: Pubkey,

    ///stake amount
    pub amount: u64,

    ///reward amount
    pub reward_amount: u64,

    pub staked_time: i64,

    ///index of the StakedInfo account. Pool account increases inc_stakes whenever there is a stake, and use it for deriving StakedInfo pda
    pub stake_index: u64
}


#[derive(Accounts)]
pub struct Stake<'info> {

    #[account(
        init,
        seeds= [
            b"stake-info".as_ref(),
            pool.key().as_ref(),
            authority.key().as_ref(),
            pool.inc_stakes.to_be_bytes().as_ref()],
        bump,
        space = 8 + size_of::<StakedInfo>(),
        payer = authority
    )]
    pub staked_info: Account<'info, StakedInfo>,

    #[account(mut, seeds = [b"state".as_ref()], bump)]
    pub state: Account<'info, StateAccount>,

    #[account(mut,
        seeds = [state.token_mint.as_ref(), &[pool.index]],
        bump)]
    pub pool: Account<'info, FarmPoolAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut,
        seeds = [state.token_mint.as_ref(), pool.key().as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = user_vault.owner == authority.key())]
    pub user_vault: Account<'info, TokenAccount>,

    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,

    pub clock: Sysvar<'info, Clock>,

    pub system_program: Program<'info, System>,

}

///This context is used in unstaking and cancelling
#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut,
        seeds= [
            b"stake-info".as_ref(),
            staked_info.pool.as_ref(),
            staked_info.authority.as_ref(),
            staked_info.stake_index.to_be_bytes().as_ref()],
        bump,
        has_one = authority,
        has_one = pool,
        close = authority
    )]
    pub staked_info: Account<'info, StakedInfo>,

    #[account(mut, seeds = [b"state".as_ref()], bump)]
    pub state: Account<'info, StateAccount>,

    #[account(mut,
        seeds = [state.token_mint.as_ref(), &[pool.index]],
        bump)]
    pub pool: Account<'info, FarmPoolAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut,
        seeds = [state.token_mint.as_ref(), pool.key().as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = user_vault.owner == authority.key())]
    pub user_vault: Account<'info, TokenAccount>,

    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,

    pub clock: Sysvar<'info, Clock>,

    pub system_program: Program<'info, System>,
}

pub fn bump(seeds: &[&[u8]]) -> u8 {
    let program_id = crate::ID;
    let (_found_key, bump) = Pubkey::find_program_address(seeds, &program_id);
    bump
}
