use anchor_lang::prelude::*;
#[error_code]
pub enum ErrorMsg {
    #[msg("Can not withdraw reserved reward")]
    AlreadyReserved,
    #[msg("Under locked")]
    UnderLocked,
    #[msg("Staking amount shouldn't be less than the minimum value")]
    BelowMinStakeAmount,
    #[msg("Overflow reserved reward")]
    OverflowReservedReward
}