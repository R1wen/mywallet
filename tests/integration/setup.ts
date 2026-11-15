// Exécuté avant chaque fichier de test d'intégration, avant ses imports :
// l'app (db client, auth) pointe sur la base de test.
const url =
  process.env.TEST_DATABASE_URL ?? "postgres://mywallet:mywallet@localhost:5433/mywallet_test";
process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "integration-tests-only-secret-0123456789abcdef";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
