-- =============================================================================
-- Akidha Marketing Desk — fix: Recycle Bin guard failed ordinary edits (D-035)
-- bin_columns_guard ran with the caller's rights and called in_bin_action(),
-- which signed-in users may not execute, so saving a task or goal could fail
-- with "permission denied for function in_bin_action". The guard now runs with
-- the owner's rights, like every other check in marketing_os_private. Its rule
-- is unchanged: the bin columns change only inside the admin bin functions.
-- Touches ONLY marketing_os_private.
-- =============================================================================

alter function marketing_os_private.bin_columns_guard() security definer;
alter function marketing_os_private.bin_columns_on_insert() security definer;
