-- Drop category check constraint to allow all Aurora-generated categories
alter table emails drop constraint if exists emails_category_check;
