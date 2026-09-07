ALTER TABLE `users` ADD `passwordHash` text;
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);
