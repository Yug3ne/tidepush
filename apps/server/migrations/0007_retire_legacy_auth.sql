-- The built-in dashboard is gone: everyone signs in to the web app (Better
-- Auth, `auth_session`). Its cookie sessions and the failed-login log that
-- rate limited its sign-in form have no users left.
--
-- People, passwords (`auth_account`) and memberships are untouched, so
-- everyone signs in to the web app with the email and password they had.

DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS login_failures;
