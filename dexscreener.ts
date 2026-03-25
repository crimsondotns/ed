import { google } from 'googleapis';
import axios from 'axios';
import fs from 'fs';
import 'dotenv/config'; // โหลดค่าจาก .env

// ==========================================
// ⚙️ CONFIGURATION (ส่วนที่ท่านสามารถปรับแต่งได้)
// ==========================================

const CONFIG = {
    // 📊 ID ของ Google Spreadsheet 
    // (สามารถดึงจาก process.env หรือใส่ตรงๆ เป็น Array เช่น ["ID1", "ID2"])
    SPREADSHEET_IDS: process.env.SPREADSHEET_IDS 
        ? process.env.SPREADSHEET_IDS.split(',').map(id => id.trim()) 
        : [""],

    // 📄 ชื่อหน้า Sheet ที่ต้องการทำงานด้วย
    SHEET_NAME: process.env.SHEET_NAME || '',

    // 🔍 ช่วงข้อมูลที่ต้องการอ่าน (ChainId และ PairAddress)
    READ_RANGE: 'A2:B', 
    
    // ✍️ ตำแหน่งเริ่มต้นที่จะเขียนข้อมูลกลับลงไป
    WRITE_START_CELL: 'C2',

    // ⏱️ ระยะห่างระหว่างดึงข้อมูล (มิลลิวินาที) - ป้องกันโดน Block API
    RATE_LIMIT_MS: 200,

    // 🔑 ไฟล์กุญแจ Service Account
    SERVICE_ACCOUNT_FILE: "./service account.json"
};

// โหลดข้อมูลยืนยันตัวตน
const SERVICE_ACCOUNT = JSON.parse(fs.readFileSync(CONFIG.SERVICE_ACCOUNT_FILE, "utf8"));

// ==========================================
// 🔧 HELPERS (ฟังก์ชันเสริม)
// ==========================================

// แปลง % เป็นทศนิยม (เช่น 5% -> 0.05)
function percentToDecimal(val: any): string | number {
    if (val === undefined || val === null) return "";
    try {
        return parseFloat(val) / 100;
    } catch {
        return "";
    }
}

// จัดรูปแบบวันที่ (MM/DD/YY) +7 UTC
function formatDate(timestamp: number): string {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    date.setHours(date.getHours() + 7);
    
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
}

// จัดรูปแบบวันที่และเวลาปัจจุบัน (MM/DD/YYYY HH:mm:ss) 
function formatCurrentDateTime(): string {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ✨ ฟังก์ชันจัดการว่าข้อมูลอะไรจะอยู่ Column ไหน (ปรับเปลี่ยนได้ง่ายที่นี่)
function mapPairDataToRow(pair: any, chainId: string) {
    if (!pair) return [];
    
    return [
        chainId,                                    // Column C
        pair.dexId || "",                           // Column D
        pair.url || "",                             // Column E
        pair.pairAddress || "",                     // Column F
        pair.baseToken?.address || "",              // Column G
        pair.baseToken?.name || "",                 // Column H
        pair.baseToken?.symbol || "",               // Column I
        pair.quoteToken?.address || "",             // Column J
        pair.quoteToken?.name || "",                // Column K
        pair.quoteToken?.symbol || "",              // Column L
        pair.priceNative || "",                     // Column M
        pair.priceUsd || "",                        // Column N
        pair.txns?.m5?.buys || "",                  // Column O
        pair.txns?.m5?.sells || "",                 // Column P
        pair.txns?.h1?.buys || "",                  // Column Q
        pair.txns?.h1?.sells || "",                 // Column R
        pair.txns?.h6?.buys || "",                  // Column S
        pair.txns?.h6?.sells || "",                 // Column T
        pair.txns?.h24?.buys || "",                 // Column U
        pair.txns?.h24?.sells || "",                // Column V
        pair.volume?.h24 || "",                     // Column W
        pair.volume?.h6 || "",                      // Column X
        pair.volume?.h1 || "",                      // Column Y
        pair.volume?.m5 || "",                      // Column Z
        percentToDecimal(pair.priceChange?.m5),     // Column AA
        percentToDecimal(pair.priceChange?.h1),     // Column AB
        percentToDecimal(pair.priceChange?.h6),     // Column AC
        percentToDecimal(pair.priceChange?.h24),    // Column AD
        pair.liquidity?.usd || "",                  // Column AE
        pair.liquidity?.base || "",                 // Column AF
        pair.liquidity?.quote || "",                // Column AG
        pair.fdv || "",                             // Column AH
        pair.marketCap || "",                       // Column AI
        formatDate(pair.pairCreatedAt),            // Column AJ
        pair.info?.imageUrl || "",                  // Column AK
        pair.info?.header || "",                    // Column AL
        pair.info?.openGraph || "",                 // Column AM
        pair.info?.websites?.find((w: any) => w.label === "Website")?.url || "", // Column AN
        pair.info?.socials?.find((s: any) => s.type === "twitter")?.url || "",    // Column AO
        formatCurrentDateTime(),                    // Column AP (อัปเดตล่าสุด)
    ];
}

// ==========================================
// 🚀 MAIN LOGIC (ส่วนประมวลผล - ไม่ต้องแก้ไข)
// ==========================================

async function processSpreadsheet(authClient: any, spreadsheetId: string) {
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const { SHEET_NAME, READ_RANGE, WRITE_START_CELL, RATE_LIMIT_MS } = CONFIG;

    try {
        // 1. อ่าน ChainId (Col A) และ PairAddress (Col B)
        const readRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${SHEET_NAME}!${READ_RANGE}`,
        });

        const rows = readRes.data.values;
        if (!rows || rows.length === 0) {
            console.log(`[${spreadsheetId}] ⚠️ ไม่พบข้อมูลที่ต้องการอ่านใน ${READ_RANGE}`);
            return;
        }

        const updates = [];
        
        // 2. ดึงข้อมูลจาก API ทีละรายการ
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const chainId = row[0]?.trim();
            const pairAddress = row[1]?.trim();

            if (!chainId || !pairAddress) continue;

            const url = `https://api.dexscreener.com/latest/dex/pairs/${chainId}/${pairAddress}`;
            
            try {
                await sleep(RATE_LIMIT_MS); 

                const startTime = Date.now();
                const response = await axios.get(url, { timeout: 10000 });
                const data = response.data;
                const pair = data.pairs && data.pairs[0];
                
                const totalTime = Date.now() - startTime;
                const status = response.status;
                const statusText = response.statusText || '';
                
                // Logging
                let statusColor = status === 200 ? '\x1b[32m' : '\x1b[31m';
                if (!pair && status === 200) statusColor = '\x1b[33m'; 
                
                console.log(`GET ${chainId}/${pairAddress} ${statusColor}${status} ${statusText}\x1b[0m in ${totalTime}ms`);
                if (pair) {
                    updates.push(mapPairDataToRow(pair, chainId));
                } else {
                    updates.push(Array(40).fill("")); // ถ้าไม่มีข้อมูล ให้ปล่อยว่างไว้แทนคำว่า "No Data"
                }

            } catch (error: any) {
                updates.push(Array(40).fill("")); // ถ้า Error ให้ปล่อยว่างไว้แทนคำว่า "Error"
            }
        }

        // 3. ล้างข้อมูลเก่าก่อนเขียนใหม่
        try {
            const clearRange = `${SHEET_NAME}!${WRITE_START_CELL}:AP5000`;
            await sheets.spreadsheets.values.clear({ spreadsheetId, range: clearRange });
        } catch (e) {}

        // 4. เขียนข้อมูลลง Sheet
        if (updates.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${SHEET_NAME}!${WRITE_START_CELL}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: updates }
            });
            console.log(`✅ บันทึกสำเร็จ: ${updates.length} แถว`);
        }

    } catch (error: any) {
        console.error(`☠️ Fatal Error (${spreadsheetId}):`, error.message);
    }
}

async function runAll() {
    const startTime = Date.now();
    console.log(`\n[${new Date().toLocaleTimeString()}] ⏳ เริ่มการทำงาน...`);
    
    const authClient = new google.auth.JWT({
        email: SERVICE_ACCOUNT.client_email,
        key: SERVICE_ACCOUNT.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const promises = CONFIG.SPREADSHEET_IDS.map(id => processSpreadsheet(authClient, id));
    await Promise.all(promises);
    
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toLocaleTimeString()}] ✨ ทำงานเสร็จสิ้นใน ${Math.floor(duration / 1000)} วินาที`);
}

// ==========================================
// ⏱️ SCHEDULER
// ==========================================

async function continuousRun() {
    try {
        await runAll();
    } catch (e) {
        console.error("Runner Error:", e);
    }
    // สุ่มพักเล็กน้อยหรือรันต่อทันที
    setTimeout(continuousRun, 5000); 
}

async function start() {
    if (process.env.GITHUB_ACTIONS) {
        console.log("🤖 Running in GitHub Actions (CI mode)");
        await runAll();
        process.exit(0);
    } else {
        continuousRun();
    }
}

start();