// DApp Connector v4. No passport/credential imports, no seed handling, no mainnet.
export function assertTestWallet(network, configuration, address) {
  if (!["preprod", "preview"].includes(network)) throw new Error("Only Preview and Preprod are allowed.");
  if (configuration.networkId !== network || !address.startsWith(`mn_addr_${network}1`)) {
    throw new Error("Wallet network mismatch. Switch your wallet to the selected test network and reconnect.");
  }
}

export async function prepareSelfTransfer(wallet, network, token) {
  const configuration = await wallet.getConfiguration();
  const { unshieldedAddress } = await wallet.getUnshieldedAddress();
  assertTestWallet(network, configuration, unshieldedAddress);
  const balances = await wallet.getUnshieldedBalances();
  const dust = await wallet.getDustBalance();
  if (!/^[a-f0-9]+$/i.test(token) || typeof balances[token] !== "bigint" || balances[token] < 1n) {
    throw new Error("Selected token has no spendable balance. Fund this network and refresh.");
  }
  if (dust.balance <= 0n) throw new Error("No tDUST available. Complete wallet registration/funding and wait for fee capacity.");
  return [{ kind: "unshielded", type: token, value: 1n, recipient: unshieldedAddress }];
}

export function initializeNetworkLab() {
  const ids = ["testNetwork", "walletChoice", "checkNetwork", "connectWallet", "networkReadout", "walletReadout", "networkFaucet", "networkExplorer", "testToken", "sendTestTransaction", "refreshWallet", "liveReceipt", "walletHistory"];
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  let wallet = null;
  let wallets = [];
  let working = false;
  let submitted = false;
  const message = error => error instanceof Error ? error.message : "Wallet request failed or was declined.";
  const phase = name => document.querySelectorAll("[data-live-step]").forEach(el => el.classList.toggle("active", el.dataset.liveStep === name));
  function discover() {
    wallets = Object.values(window.midnight || {}).filter(api => typeof api?.connect === "function");
    ui.walletChoice.replaceChildren(...(wallets.length ? wallets.map((api, i) => new Option(api.name || `Wallet ${i + 1}`, String(i))) : [new Option("No compatible wallet detected", "")]));
  }
  function lock(value) {
    working = value;
    [ui.testNetwork, ui.walletChoice, ui.connectWallet, ui.checkNetwork].forEach(el => el.disabled = value);
    ui.refreshWallet.disabled = value || !wallet;
    ui.testToken.disabled = value || !wallet;
    ui.sendTestTransaction.disabled = value || !wallet || submitted || !ui.testToken.value;
  }
  async function readNetwork() {
    ui.networkReadout.textContent = "Reading real finalized block from Midnight…";
    const response = await fetch(`/api/midnight/network?network=${ui.testNetwork.value}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.code);
    ui.networkReadout.textContent = `${result.chain} · finalized block #${result.height} · checked ${new Date(result.checkedAt).toLocaleTimeString()} · ${result.finalizedHash}`;
  }
  async function refreshWallet() {
    const configuration = await wallet.getConfiguration();
    const { unshieldedAddress } = await wallet.getUnshieldedAddress();
    assertTestWallet(ui.testNetwork.value, configuration, unshieldedAddress);
    const [balances, dust] = await Promise.all([wallet.getUnshieldedBalances(), wallet.getDustBalance()]);
    const previous = ui.testToken.value;
    const tokens = Object.entries(balances).filter(([, value]) => typeof value === "bigint" && value > 0n);
    ui.testToken.replaceChildren(...(tokens.length ? tokens.map(([type, value]) => new Option(`${type} · balance ${value} raw units`, type)) : [new Option("No test tokens — fund this network", "")]));
    if (tokens.some(([type]) => type === previous)) ui.testToken.value = previous;
    ui.walletReadout.textContent = `${configuration.networkId} · your public self-transfer address: ${unshieldedAddress} · tDUST balance: ${dust.balance} raw units (wallet checks fee sufficiency)`;
    try {
      const history = await wallet.getTxHistory(0, 5);
      ui.walletHistory.replaceChildren(...history.map(entry => {
        const row = document.createElement("div");
        row.textContent = `${entry.txHash} · ${entry.txStatus.status} · execution: ${JSON.stringify(entry.txStatus.executionStatus ?? "not reported")}`;
        return row;
      }));
      if (!history.length) ui.walletHistory.textContent = "No recent transactions reported by wallet.";
    } catch { ui.walletHistory.textContent = "History unavailable. Inspect your wallet or explorer; do not infer finality."; }
  }
  ui.checkNetwork.addEventListener("click", async () => {
    if (working) return;
    lock(true);
    try { await readNetwork(); } catch (error) { ui.networkReadout.textContent = message(error); } finally { lock(false); }
  });
  ui.connectWallet.addEventListener("click", async () => {
    if (working) return;
    if (!wallets.length) discover();
    if (!wallets.length) {
      ui.walletReadout.textContent = "No compatible wallet detected. Open this app in a browser with a Midnight DApp Connector v4 wallet enabled, then retry. The animation works without a wallet.";
      return;
    }
    lock(true);
    wallet = null;
    try {
      ui.walletReadout.textContent = "Approve the connection in your wallet…";
      wallet = await wallets[Number(ui.walletChoice.value)].connect(ui.testNetwork.value);
      for (const name of ["makeTransfer", "submitTransaction", "getConfiguration", "getUnshieldedAddress", "getUnshieldedBalances", "getDustBalance"]) {
        if (typeof wallet[name] !== "function") throw new Error("This wallet does not support the required DApp Connector v4 methods.");
      }
      await refreshWallet();
    } catch (error) { wallet = null; ui.walletReadout.textContent = message(error); } finally { lock(false); }
  });
  ui.testNetwork.addEventListener("change", () => {
    wallet = null;
    ui.testToken.replaceChildren(new Option("Connect to load balances", ""));
    ui.walletHistory.textContent = "No history loaded for this network.";
    ui.walletReadout.textContent = "Network changed. Reconnect your wallet on this network.";
    ui.networkReadout.textContent = "Not checked on this network.";
    const network = ui.testNetwork.value;
    ui.networkFaucet.href = `https://midnight-tmnight-${network}.nethermind.dev/`;
    ui.networkFaucet.textContent = `Matching ${network} faucet ↗`;
    ui.networkExplorer.href = `https://${network}.midnightexplorer.com/`;
    ui.networkExplorer.textContent = `Open ${network} explorer ↗`;
    lock(false);
  });
  ui.walletChoice.addEventListener("change", () => { wallet = null; ui.walletReadout.textContent = "Wallet changed. Connect the selected wallet."; lock(false); });
  ui.refreshWallet.addEventListener("click", async () => {
    if (working || !wallet) return;
    lock(true);
    try { await refreshWallet(); } catch (error) { wallet = null; ui.walletReadout.textContent = message(error); } finally { lock(false); }
  });
  ui.sendTestTransaction.addEventListener("click", async () => {
    if (working || !wallet || submitted) return;
    lock(true);
    let submitting = false;
    let timer;
    try {
      phase("prepare");
      await readNetwork();
      const outputs = await prepareSelfTransfer(wallet, ui.testNetwork.value, ui.testToken.value);
      phase("approve");
      const started = performance.now();
      const update = () => { ui.liveReceipt.textContent = `Waiting for wallet approval / transaction build · ${((performance.now() - started) / 1000).toFixed(1)}s elapsed. Sends 1 raw unit to your own address; test-network DUST pays fees. No ballot data. Cancel in your wallet to stop.`; };
      update(); timer = setInterval(update, 250);
      const { tx } = await wallet.makeTransfer(outputs, { payFees: true });
      clearInterval(timer);
      const buildSeconds = ((performance.now() - started) / 1000).toFixed(1);
      if (typeof tx !== "string" || !tx.length) throw new Error("Wallet returned no transaction.");
      // Recheck the network immediately before the only broadcast call.
      assertTestWallet(ui.testNetwork.value, await wallet.getConfiguration(), outputs[0].recipient);
      submitting = true;
      submitted = true;
      phase("submit");
      ui.liveReceipt.textContent = "Submitting the wallet-built test transaction. Do not retry while pending…";
      const sent = performance.now();
      await wallet.submitTransaction(tx);
      phase("receipt");
      ui.liveReceipt.textContent = `${ui.testNetwork.value} · wallet acknowledged submission at ${new Date().toLocaleTimeString()}. Approval/build: ${buildSeconds}s; submission: ${((performance.now() - sent) / 1000).toFixed(1)}s. NOT confirmed yet. Connector v4 returns no transaction hash from submission; inspect wallet history below. One submission per page session; demo reset cannot undo this transaction.`;
      try { await refreshWallet(); } catch { ui.walletReadout.textContent = "Refresh the wallet to check receipt/history."; }
    } catch (error) {
      ui.liveReceipt.textContent = submitting ? `Submission outcome unknown: ${message(error)}. No automatic retry. Inspect your wallet before considering another transaction.` : `Not submitted by this app: ${message(error)}`;
    } finally { clearInterval(timer); lock(false); }
  });
  discover();
  window.addEventListener("focus", () => { if (!working && !wallet) discover(); });
}
