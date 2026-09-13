export function formatUnits(raw, places) {
  if (typeof raw !== "bigint" || raw < 0n || !Number.isInteger(places) || places < 0 || places > 18) throw new Error("INVALID_AMOUNT");
  const divisor = 10n ** BigInt(places);
  return `${raw / divisor}.${(raw % divisor).toString().padStart(places, "0")}`;
}

export function selectRegistrationCoins(coins, nativeType) {
  const night = coins.filter(coin => coin.utxo.type === nativeType);
  return { night, unregistered: night.filter(coin => coin.meta?.registeredForDustGeneration !== true) };
}
