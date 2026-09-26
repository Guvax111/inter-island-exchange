-- Exchange rates are append-only like the other money records: refuse TRUNCATE as well.
CREATE TRIGGER exchange_rates_no_truncate BEFORE TRUNCATE ON exchange_rates
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
