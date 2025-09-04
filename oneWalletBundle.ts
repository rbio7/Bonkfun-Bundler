import { Commitment, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAssociatedTokenAddress, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Raydium, getATAAddress, buyExactInInstruction, getPdaLaunchpadAuth, getPdaLaunchpadConfigId, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId, TxVersion, LAUNCHPAD_PROGRAM, LaunchpadConfig } from '@raydium-io/raydium-sdk-v2';
import base58 from 'bs58';
import axios from 'axios';
import { BN } from 'bn.js';
import { createBonkTokenMetadata, createImageMetadata } from 'ipfs-pack';
import { openAsBlob } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const RPC_ENDPOINT = process.env.RPC_ENDPOINT!;
const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT!;
const BUYER_WALLET = process.env.BUYER_WALLET!;
const BUYER_AMOUNT = Number(process.env.BUYER_AMOUNT || 0);
const TOKEN_NAME = process.env.TOKEN_NAME!;
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL!;
const DESCRIPTION = process.env.DESCRIPTION || '';
const FILE = process.env.FILE!;
const JITO_FEE = Number(process.env.JITO_FEE || 0);
const BONK_PLATFROM_ID = new PublicKey('FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1');
const commitment: Commitment = 'confirmed';

const connection = new Connection(RPC_ENDPOINT, { wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment });
let raydium: Raydium | undefined;

async function initSdk(wallet: PublicKey, params?: { loadToken?: boolean }) {
  if (raydium) return raydium;
  raydium = await Raydium.load({
    owner: wallet,
    connection,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    disableLoadToken: !params?.loadToken,
    blockhashCommitment: 'confirmed',
  });
  return raydium;
}

async function createBonkFunTokenMetadata() {
  const imageInfo = { file: await openAsBlob(FILE) };
  const imageMetadata = await createImageMetadata(imageInfo);
  const tokenInfo = {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: DESCRIPTION,
    createdOn: 'https://bonk.fun',
    platformId: 'platformId',
    image: imageMetadata,
  };
  const tokenMetadata = await createBonkTokenMetadata(tokenInfo);
  return tokenMetadata.resultText;
}

async function createBonkTokenTx(connection: Connection, mainKp: Keypair, mintKp: Keypair) {
  const uri = await createBonkFunTokenMetadata();
  const raydium = await initSdk(mainKp.publicKey);
  const configId = getPdaLaunchpadConfigId(LAUNCHPAD_PROGRAM, NATIVE_MINT, 0, 0).publicKey;
  const configData = await connection.getAccountInfo(configId);
  if (!configData) throw new Error('Config not found');
  const configInfo = LaunchpadConfig.decode(configData.data);
  const mintBInfo = await raydium.token.getTokenInfo(configInfo.mintB);

  const solBuyAmount = 0.01;
  const buyAmount = new BN(solBuyAmount * 1e9);
  const slippage = new BN(10);

  const { transactions } = await raydium.launchpad.createLaunchpad({
    programId: LAUNCHPAD_PROGRAM,
    mintA: mintKp.publicKey,
    decimals: 6,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    migrateType: 'amm',
    uri,
    configId,
    configInfo,
    mintBDecimals: mintBInfo.decimals,
    slippage,
    platformId: BONK_PLATFROM_ID,
    txVersion: TxVersion.LEGACY,
    buyAmount,
    feePayer: mainKp.publicKey,
    createOnly: true,
    extraSigners: [mintKp],
    computeBudgetConfig: { units: 1_200_000, microLamports: 100_000 },
  });

  const tipAccounts = [
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  ];
  const jitoFeeWallet = new PublicKey(tipAccounts[Math.floor(Math.random() * tipAccounts.length)]);
  const { blockhash } = await connection.getLatestBlockhash();
  const ixs = transactions[0].instructions;
  ixs.push(
    SystemProgram.transfer({
      fromPubkey: mainKp.publicKey,
      toPubkey: jitoFeeWallet,
      lamports: Math.floor(JITO_FEE * LAMPORTS_PER_SOL),
    }),
  );
  const msg = new TransactionMessage({
    payerKey: mainKp.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(msg);
  transaction.sign([mainKp, mintKp]);
  return transaction;
}

async function makeBuyIx(kp: Keypair, buyAmount: number, mintAddress: PublicKey) {
  const lamports = buyAmount;
  const programId = LAUNCHPAD_PROGRAM;
  const configId = getPdaLaunchpadConfigId(programId, NATIVE_MINT, 0, 0).publicKey;
  const poolId = getPdaLaunchpadPoolId(programId, mintAddress, NATIVE_MINT).publicKey;
  const userTokenAccountA = getAssociatedTokenAddressSync(mintAddress, kp.publicKey);
  const userTokenAccountB = getAssociatedTokenAddressSync(NATIVE_MINT, kp.publicKey);
  const rentExemptionAmount = await connection.getMinimumBalanceForRentExemption(165);
  const buyerBalance = await connection.getBalance(kp.publicKey);
  const requiredBalance = rentExemptionAmount * 2 + lamports;
  if (buyerBalance < requiredBalance) throw new Error('Insufficient funds');
  const vaultA = getPdaLaunchpadVaultId(programId, poolId, mintAddress).publicKey;
  const vaultB = getPdaLaunchpadVaultId(programId, poolId, NATIVE_MINT).publicKey;
  const shareATA = getATAAddress(kp.publicKey, NATIVE_MINT).publicKey;
  const authProgramId = getPdaLaunchpadAuth(programId).publicKey;
  const minmintAmount = new BN(1);
  const tokenAta = await getAssociatedTokenAddress(mintAddress, kp.publicKey);
  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, kp.publicKey);

  return [
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, tokenAta, kp.publicKey, mintAddress),
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, wsolAta, kp.publicKey, NATIVE_MINT),
    SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: wsolAta, lamports }),
    createSyncNativeInstruction(wsolAta),
    buyExactInInstruction(
      programId,
      kp.publicKey,
      authProgramId,
      configId,
      BONK_PLATFROM_ID,
      poolId,
      userTokenAccountA,
      userTokenAccountB,
      vaultA,
      vaultB,
      mintAddress,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      new BN(lamports),
      minmintAmount,
      new BN(10000),
      shareATA,
    ),
  ];
}

async function executeJitoTx(transactions: VersionedTransaction[], commitment: Commitment) {
  const serialized = transactions.map(tx => base58.encode(tx.serialize()));
  const endpoints = [
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  const requests = endpoints.map(url => axios.post(url, { jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [serialized] }));
  const results = await Promise.all(requests.map(p => p.catch(e => e)));
  if (results.some(r => !(r instanceof Error))) {
    const sig = base58.encode(transactions[0].signatures[0]);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight }, commitment);
    console.log('Bundle confirmed:', sig);
    return sig;
  }
  console.log('Failed to send bundle via Jito');
  return null;
}

async function main() {
  const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
  const mintKp = Keypair.generate();
  const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET));
  const tokenCreationTx = await createBonkTokenTx(connection, mainKp, mintKp);
  const latestBlockhash = await connection.getLatestBlockhash();
  const buyIx = await makeBuyIx(buyerKp, Math.floor(BUYER_AMOUNT * LAMPORTS_PER_SOL), mintKp.publicKey);
  const message = new TransactionMessage({
    payerKey: buyerKp.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
      ...buyIx,
    ],
  }).compileToV0Message();
  const buyTx = new VersionedTransaction(message);
  buyTx.sign([buyerKp]);
  await executeJitoTx([tokenCreationTx, buyTx], commitment);
}

main().catch(err => console.error(err));
