import { parseReceiptOcrText } from './receipt-text-parser';

/**
 * The receipt battery ADR 0185 scored its copy and restatement rules on, with
 * the counterexamples ADR 0185 and ADR 0186 found, and every reading recorded:
 * the amount, its grade, the rule that demoted it where one did, the direction
 * and its grade. Each text is read twice: joined, as Vision hands a line back,
 * and split, where every line that is not an ISO date line becomes its label
 * and its last figure. A change that moves a reading edits its row here, and
 * the record that makes the change states the new score (ADR 0145). Silence
 * is counted two ways: as ADR 0185 scored it, and in the stricter sense ADR
 * 0186 holds every change to.
 *
 * The readings are the same in every zone and under either day/month order,
 * so this file runs in test:ci alone (docs/dates.md). They are taken as of
 * 30 October 2026, and the clock is held on that day: the future-date guard
 * decides some of them, and from 22 January 2027, 23.01.27 read day first
 * is no longer a date to turn down.
 */

type Kind = 'refund' | 'purchase';

/**
 * A receipt: its id, its text, what it is, the total it should read (null
 * where it prints none), and its recorded joined and split readings, '=' where
 * the split reads as the joined.
 */
type Row = readonly [
  id: string,
  text: string,
  kind: Kind,
  amount: number | null,
  joined: string,
  split: string,
];

type Layout = 'joined' | 'split';

/** The sixty receipts: refunds R1 to R32 and purchases P1 to P52, not all numbered. */
const BATTERY: readonly Row[] = [
  ['R1', 'Shop\nTotal ($12.50)', 'refund', 12.5, '12.5 0.8 credit 0.5', '='],
  ['R2', '店\n（¥1,280）', 'refund', 1280, '1280 0.8 credit 0.5', '='],
  ['R3', 'Shop\nTotal (12.50)', 'refund', 12.5, '12.5 0.5 credit 0.5', '='],
  ['R4', 'OUTDOOR CO\n2026-09-28\nREFUND\nJacket ($59.99)\nTax ($4.80)\nTotal ($64.79)\nVISA ($64.79)', 'refund', 64.79, '64.79 0.8 credit 0.5', '='],
  ['R5', 'OUTDOOR CO\nJacket (59.99)\nTax (4.80)\nTotal (64.79)', 'refund', 64.79, '64.79 0.5 credit 0.5', '='],
  ['R6', 'OUTDOOR CO\nRETURN\nJacket 59.99\nTax 4.80\nTotal (64.79)', 'refund', 64.79, '64.79 0.5 credit 0.5', '='],
  ['R7', 'OUTDOOR CO\nJacket $59.99\nTax $4.80\nRefund total ($64.79)', 'refund', 64.79, '64.79 0.8 credit 0.5', '='],
  ['R8', '店\n商品 (¥1,180)\n消費税 (¥100)\n合計 (¥1,280)', 'refund', 1280, '1280 0.8 credit 0.5', '='],
  ['R9', '店\n合計 (¥1,280)', 'refund', 1280, '1280 0.8 credit 0.5', '='],
  ['R10', '店\n商品 (1,180)\n消費税 (100)\n合計 (1,280)', 'refund', 1280, '1280 0.5 credit 0.5', '='],
  ['R11', '店\n合計 (1,280)', 'refund', 1280, '1280 0.5 credit 0.5', '='],
  ['R12', '스타벅스\n취소\n카페라떼 (5,900)\n합계 (5,900)', 'refund', 5900, '5900 0.5 credit 0.5', '='],
  ['R13', '스타벅스\n합계 (₩5,900)', 'refund', 5900, '5900 0.8 credit 0.5', '='],
  ['R14', '스타벅스\n취소\n카페라떼 -5,900\n합계 -5,900', 'refund', 5900, '5900 0.5 credit 0.5', '='],
  ['R15', 'Shop\n合計-1,280', 'refund', 1280, '1280 0.5 credit 0.5', '='],
  ['R16', '店\n合計-¥1,280', 'refund', 1280, '1280 0.8 credit 0.5', '='],
  ['R17', '스타벅스\n합계-5,900', 'refund', 5900, '5900 0.5 credit 0.5', '='],
  ['R18', 'Shop\nTotal (-12.50)', 'refund', 12.5, '12.5 0.5 credit 0.5', '='],
  ['R19', 'Shop\nTotal (-$12.50)', 'refund', 12.5, '12.5 0.8 credit 0.5', '='],
  ['R20', 'Shop\nTotal =-12.50', 'refund', 12.5, '12.5 0.5 credit 0.5', '='],
  ['R21', '店\n合計＝-1,280', 'refund', 1280, '1280 0.5 credit 0.5', '='],
  ['R22', '店\n合計（-¥1,280）', 'refund', 1280, '1280 0.8 credit 0.5', '='],
  ['R23', 'HARBOUR SUPPLIES\n2026-09-28 14:32\nREFUND\nMooring rope 10m -$10.00\nTOTAL -$10.00', 'refund', 10, '10 0.8 debit 0.3', '10 0.8 credit 0.5'],
  ['R24', 'HARBOUR\nRope 10m -10 USD\nTOTAL -10 USD', 'refund', 10, '10 0.8 debit 0.3', '='],
  ['R25', 'Shop\nCable 1m -$1.00\nTotal -$1.00', 'refund', 1, '1 0.8 debit 0.3', '1 0.8 credit 0.5'],
  ['R26', 'Shop\n2 pcs -$2.00\nTotal -$2.00', 'refund', 2, '2 0.8 debit 0.3', '2 0.8 credit 0.5'],
  ['R28', '店\n返品\nおにぎり-¥168\n合計-¥168', 'refund', 168, '168 0.8 debit 0.3', '='],
  ['R29', '店\n返品\nおにぎり -¥168\n合計 -¥168', 'refund', 168, '168 0.8 credit 0.5', '='],
  ['R30', 'Shop\nREFUND\nSubtotal (10.00)\nTax (0.80)\nTotal (10.80)', 'refund', 10.8, '10.8 0.5 credit 0.5', '='],
  ['R31', '店\n商品 ¥1,280\n合計 (¥1,280)', 'refund', 1280, '1280 0.8 debit 0.3', '='],
  ['R32', '店\nロープ 10m -¥10\n合計 -¥10', 'refund', 10, '10 0.8 debit 0.3', '10 0.8 credit 0.5'],
  ['P1', '店\n合計 ¥1,180\n(¥1,280)', 'purchase', 1180, '1280 0.8 credit 0.5', '='],
  ['P2', 'Shop\nPoints (1,250)', 'purchase', null, '1250 0.5 credit 0.5', '='],
  ['P3', 'Shop\nCoffee 4.50\nTotal 12.50\nPoints (1,250)', 'purchase', 12.5, '1250 0.5 credit 0.5', '='],
  ['P4', 'Shop\nTotal 12.50\nPoints balance (1,250)', 'purchase', 12.5, '1250 0.5 credit 0.5', '='],
  ['P5', '店\n合計 1,180\n(1,280)', 'purchase', 1180, '1280 0.5 credit 0.5', '='],
  ['P6', 'Shop\nJacket $59.99\nWas ($79.99)\nTotal $59.99', 'purchase', 59.99, '79.99 0.8 credit 0.5', '='],
  ['P7', '店\n定価(¥1,580)\n割引 -¥300\n合計 ¥1,280', 'purchase', 1280, '1580 0.8 credit 0.5', '='],
  ['P8', 'Shop\nTotal $12.50\n(Reg $15.00)', 'purchase', 12.5, '12.5 0.6 aside debit 0', '='],
  ['P9', '店\n合計 ¥1,280\n(内消費税 ¥116)', 'purchase', 1280, '1280 0.8 debit 0', '='],
  ['P10', '店\n合計 ¥1,280\n(¥116)', 'purchase', 1280, '1280 0.8 debit 0', '='],
  ['P12', '店\n合計 ¥1,180\n（¥1,298）', 'purchase', 1180, '1298 0.8 credit 0.5', '='],
  ['P13', 'Shop\nTotal 12.50\nPoints earned (125)', 'purchase', 12.5, '12.5 0.5 debit 0', '='],
  ['P14', 'Shop\n$12.50\nPoints (1,250)', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['P16', '店\n品番-1234\n合計 980', 'purchase', 980, '1234 0.3 credit 0.5', '='],
  ['P17', '店\n品番-1234\n合計 ¥980', 'purchase', 980, '980 0.8 debit 0', '='],
  ['P18', '店\n受付-1234\n合計 1,280', 'purchase', 1280, '1280 0.5 debit 0', '='],
  ['P19', '店\n値引-100\n合計 1,180', 'purchase', 1180, '1180 0.5 debit 0', '='],
  ['P21', '店\nアイスコーヒ-480\n合計 480', 'purchase', 480, '480 0.3 debit 0', '='],
  ['P23', 'Shop\n2 x 4.50 =9.00\nTotal 9.00', 'purchase', 9, '9 0.5 debit 0', '='],
  ['P24', 'Shop\nSubtotal 10.00\nDiscount =-1.00\nTotal 9.00', 'purchase', 9, '9 0.38 tender debit 0', '='],
  ['P26', 'Shop\n(-$1.00 saved)\nTotal $12.50', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['P34', '店\nレジ-04 担当-123\n合計 98', 'purchase', 98, '123 0.3 credit 0.5', '='],
  ['P43', 'Shop\nCoupon (-$1.00)\nTotal $4.50', 'purchase', 4.5, '4.5 0.8 debit 0', '='],
  ['P44', 'Shop\nTotal $4.50\nYou saved (-$5.00)', 'purchase', 4.5, '5 0.8 credit 0.5', '='],
  ['P45', 'Shop\nTotal $4.50\nSavings -$5.00', 'purchase', 4.5, '5 0.8 credit 0.5', '='],
  ['P46', 'Shop\nItem 4.50\nQty (-1)\nTotal 4.50', 'purchase', 4.5, '4.5 0.5 debit 0', '='],
  ['P50', '店\n合計 ¥1,180\n(税込¥1,298)', 'purchase', 1298, '1180 0.6 aside debit 0', '='],
  ['P51', '店\n合計 ¥1,298\n(内税 ¥118)', 'purchase', 1298, '1298 0.8 debit 0', '='],
  ['P52', '店\n小計 ¥1,180\n合計 ¥1,298\n(¥1,298)', 'purchase', 1298, '1298 0.8 debit 0.3', '='],
];

/** ADR 0185's thirteen counterexamples and pins. */
const ADR_0185: readonly Row[] = [
  ['X1', 'REFUND\nJacket $59.99\nTax $4.80\n($64.79)', 'refund', 64.79, '64.79 0.8 credit 0.5', '='],
  ['X2', 'REFUND\nItem 1 $10.00\nItem 2 $5.00\n($15.00)', 'refund', 15, '15 0.8 credit 0.5', '='],
  ['X3', '返品\n合計\n(¥1,280)\n(内消費税等 ¥116)', 'refund', 1280, '1280 0.8 credit 0.5', '='],
  ['X4', '返品\n2026年1月15日\nおにぎり ¥168\n小計 ¥168\n合計\n(¥168)\n(内消費税等 ¥12)', 'refund', 168, '168 0.8 debit 0.3', '='],
  ['X5', '返品\nジャケット ¥5,980\n消費税 ¥598\n(¥6,578)', 'refund', 6578, '6578 0.8 credit 0.5', '='],
  ['X6', 'Shop\nTotal ¥  480\nVISA -¥480', 'purchase', 480, '480 0.8 debit 0.3', '480 0.8 credit 0.5'],
  ['X7', 'Shop\nTOTAL 14 Card -$14', 'purchase', 14, '14 0.8 debit 0.3', '14 0.8 credit 0.5'],
  ['X8', 'Shop\nTotal -$14\nVISA 14 USD', 'purchase', 14, '14 0.8 debit 0.3', '='],
  ['X9', '店\n¥ 合計 -480', 'refund', 480, '480 0.8 credit 0.5', '480 0.3 credit 0.5'],
  ['X10', '店\n¥ 合計 480', 'purchase', 480, '480 0.8 debit 0', '480 0.3 debit 0'],
  ['X11', 'Shop\nMooring rope 10m -$10.00\nTOTAL -$10.00', 'refund', 10, '10 0.8 debit 0.3', '10 0.8 credit 0.5'],
  ['X12', 'Shop\nTotal $59.99\nWas ($79.99)', 'purchase', 59.99, '79.99 0.8 credit 0.5', '='],
  ['X13', 'Shop\nTotal 980\nPoints (1,250)', 'purchase', 980, '1250 0.5 credit 0.5', '='],
];

/**
 * ADR 0186's counterexamples, C1 to C180, not all numbered: priced lines,
 * dates, counts, asides, times, tenders, signs shared by two figures,
 * marked figures beside a bare total, and the figures a date reader reaches
 * once a currency sign or a line break parts them.
 */
const ADR_0186: readonly Row[] = [
  ['C1', 'Shop\nItem 1 $10.00', 'purchase', 10, '10 0.8 debit 0', '='],
  ['C2', 'Shop\nTickets 2 $5 $10', 'purchase', 10, '10 0.8 debit 0', '='],
  ['C3', 'Bäckerei\nBrot 1 2,10 €', 'purchase', 2.1, '0 0 debit 0', '='],
  ['C4', 'Shop\nTotal $5.15\n01/15/2026', 'purchase', 5.15, '5.15 0.8 debit 0', '='],
  ['C5', 'Shop\nTOTAL $12.50 01/15/2026', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C6', 'Shop\nTotal $5.15\n12:30', 'purchase', 5.15, '5.15 0.8 debit 0', '='],
  ['C7', 'Shop\n$15.00 01/15/26', 'purchase', 15, '15 0.8 debit 0', '='],
  ['C8', 'Shop\nSKU 2025 $1.10\nTotal $1.10', 'purchase', 1.1, '1.1 0.8 debit 0', '='],
  ['C9', 'Shop\nSKU 1234 $1.45\nTotal $1.45', 'purchase', 1.45, '1.45 0.8 debit 0', '='],
  ['C10', 'Shop\nPack of 24 $5.00\nTotal $5.00', 'purchase', 5, '5 0.8 debit 0', '='],
  ['C11', 'Shop\nPack of 24 $5\nTotal $5', 'purchase', 5, '5 0.8 debit 0', '='],
  ['C12', 'Shop\nRoom 412 $89.00\nTax $8.90\nTotal $97.90', 'purchase', 97.9, '97.9 0.6 count debit 0', '97.9 0.8 debit 0'],
  ['C13', 'Shop\nTax 8% $0.40\nTotal $5.40', 'purchase', 5.4, '5.4 0.6 count debit 0', '5.4 0.8 debit 0'],
  ['C14', '店\n緑茶 500ml ¥151\n合計 ¥151', 'purchase', 151, '151 0.8 debit 0', '='],
  ['C15', 'Bäckerei\nBrötchen 12 1,10 €\nSumme 1,10 €\n20.10.2026', 'purchase', 1.1, '1.1 0.8 debit 0', '='],
  ['C16', 'REFUND\nPack of 12 -$10.00\nTotal -$10.00', 'refund', 10, '10 0.8 credit 0.5', '='],
  ['C17', 'Shop\nPack of 12 -$12.00\nTotal -$12.00', 'refund', 12, '12 0.8 debit 0.3', '12 0.8 credit 0.5'],
  ['C18', 'Shop\nTotal 1280 Tax ¥116', 'purchase', 1280, '116 0.6 count debit 0', '116 0.8 debit 0'],
  ['C19', 'Shop\nTotal 12 Tax $0.96', 'purchase', 12, '0.96 0.6 count debit 0', '0.96 0.8 debit 0'],
  ['C20', 'Shop\nRoom 412 $89.00', 'purchase', 89, '89 0.6 count debit 0', '89 0.8 debit 0'],
  ['C22', '店\n合計 ¥1,280\n（定価 ¥1,580）', 'purchase', 1280, '1280 0.6 aside debit 0', '='],
  ['C23', '가게\n합계 ₩12,500\n(정가 ₩15,000)', 'purchase', 12500, '12500 0.6 aside debit 0', '='],
  ['C24', 'Shop\nGift card $12.50\n(Balance $87.50)', 'purchase', 12.5, '12.5 0.6 aside debit 0', '='],
  ['C25', 'REFUND\nTotal -$12.50\n(Reg $15.00)', 'refund', 12.5, '12.5 0.6 aside credit 0.5', '='],
  ['C26', 'Shop\nTotal 12.50\n(Reg $15.00)', 'purchase', 12.5, '15 0.6 aside debit 0', '='],
  ['C27', '店\n合計 980\n(内税 ¥72)', 'purchase', 980, '72 0.6 aside debit 0', '='],
  ['C28', 'REFUND\nJacket $59.99\nTax $4.80\n(Refund -$64.79)', 'refund', 64.79, '64.79 0.8 credit 0.5', '='],
  ['C29', '返品\nジャケット ¥5,980\n消費税 ¥598\n(返金 -¥6,578)', 'refund', 6578, '6578 0.8 credit 0.5', '='],
  ['C30', 'REFUND\nJacket $59.99\nTax $4.80\n(Total $64.79)', 'refund', 64.79, '59.99 0.6 aside debit 0', '='],
  ['C31', '店\n合計 ¥1,000\n（税込 ¥1,100）', 'purchase', 1100, '1000 0.6 aside debit 0', '='],
  ['C32', 'Shop\nSubtotal $11.30\n(Total incl. tax $12.50)', 'purchase', 12.5, '11.3 0.6 aside debit 0', '='],
  ['C33', 'Shop\nItem $5.00\nItem $7.50\nPaid (VISA $12.50)', 'purchase', 12.5, '7.5 0.6 aside debit 0', '='],
  ['C34', 'Shop\nTotal $12.50\n(REG$15.00)', 'purchase', 12.5, '15 0.8 credit 0.5', '='],
  ['C35', '返品\nジャケット 5,980円\n消費税 598円\n(6,578円)', 'refund', 6578, '5980 0.38 aside debit 0', '='],
  ['C36', 'Shop\nTotal $12.50\n(Reg $15.00', 'purchase', 12.5, '15 0.8 debit 0', '='],
  ['C37', 'Shop\nTotal $12.50\nReg. Price $15.00', 'purchase', 12.5, '15 0.8 debit 0', '='],
  ['C38', 'Shop\nNote (see back\nTotal $12.50)\nItem $3.00', 'purchase', 12.5, '3 0.6 aside debit 0', '12.5 0.8 debit 0'],
  ['C39', 'Shop\n2026-01-15 14:32\n(Total $64.79)', 'purchase', 64.79, '64.79 0.6 aside debit 0', '='],
  ['C40', 'REFUND\n(Total $64.79)', 'refund', 64.79, '64.79 0.8 debit 0', '='],
  ['C41', '店\n合計 980 内税 ¥72\n(内消費税等 ¥72)', 'purchase', 980, '72 0.6 count debit 0', '72 0.8 debit 0'],
  ['C42', '店\n合計 1280 内税 ¥116\n内消費税等 ¥116', 'purchase', 1280, '116 0.6 count debit 0', '116 0.8 debit 0'],
  ['C43', 'Shop\nTotal 12 Tax $0.96\n(Tax $0.96)', 'purchase', 12, '0.96 0.6 count debit 0', '0.96 0.8 debit 0'],
  ['C44', 'Shop\nBurger $8.00\nFries $3.04\nTotal 12 Tax $0.96', 'purchase', 12, '8 0.6 count debit 0', '8 0.8 debit 0'],
  ['C45', '店\nおにぎり ¥168\nお茶 ¥151\n合計 319 内税 ¥23', 'purchase', 319, '168 0.6 count debit 0', '168 0.8 debit 0'],
  ['C46', '店\n小計 ¥296\n合計 319 内税 ¥23', 'purchase', 319, '296 0.6 count debit 0', '296 0.8 debit 0'],
  ['C47', 'Shop\nItem ¥200\nTotal 1280 Tax ¥116', 'purchase', 1280, '200 0.6 count debit 0', '200 0.8 debit 0'],
  ['C48', 'Rest\nSteak $30.00\nSalad $9.00\nTotal 48 Tip $8', 'purchase', 48, '30 0.6 count debit 0', '30 0.8 debit 0'],
  ['C49', 'Shop\nItem $8.00\nSubtotal $8.00\nTotal 9 Tax $1.00', 'purchase', 9, '8 0.6 count debit 0', '8 0.8 debit 0'],
  ['C50', '店\n合計 538 お預り ¥1,000 お釣り ¥462', 'purchase', 538, '538 0.6 tender debit 0', '='],
  ['C51', 'Shop\nItem 2 $3.00\nTotal $5.00', 'purchase', 5, '5 0.8 debit 0', '='],
  ['C52', 'Shop\nItem 3 $2.00\nTotal $5.00', 'purchase', 5, '5 0.8 debit 0', '='],
  ['C53', 'Shop\nCard -$14\nTOTAL 14 Tax $1.04', 'purchase', 14, '14 0.8 debit 0.3', '14 0.8 credit 0.5'],
  ['C54', 'Shop\nTotal 12 Tax -$0.96', 'purchase', 12, '0.96 0.6 count debit 0.3', '0.96 0.8 credit 0.5'],
  ['C55', 'Laden\nSumme 12 € 3 Artikel', 'purchase', 12, '12 0.8 debit 0', '='],
  ['C56', 'Shop\nDate: 15/01/\'26 Total: $12.50', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C57', 'Shop\nDate: 15.01 .26 Total: $12.50', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C58', 'Shop\n15.01 .26 14:32\nTotal 12.50', 'purchase', 12.5, '12.5 0.5 debit 0', '='],
  ['C59', 'REFUND\n2026-09-28 14:32 TOTAL -$14.00', 'refund', 14, '14 0.8 debit 0.3', '='],
  ['C60', 'Shop\nItem 2 $1.00', 'purchase', 1, '1 0.6 count debit 0', '1 0.8 debit 0'],
  ['C61', 'Harbour Supplies\nRope 1 $10.00\nTotal: $10.00\n01/15/2026', 'purchase', 10, '10 0.8 debit 0', '='],
  ['C62', 'Shop\nEggs 12 $4.99\nMilk 1 $3.49\nTotal $8.48', 'purchase', 8.48, '8.48 0.6 count debit 0', '8.48 0.8 debit 0'],
  ['C63', 'Shop\n14:32 Total $10.00', 'purchase', 10, '10 0.8 debit 0', '='],
  ['C64', 'REFUND\nItem 3 -$1.50\nTotal 2 items -$3.00', 'refund', 3, '3 0.8 debit 0.3', '3 0.8 credit 0.5'],
  ['C65', '店\n合計 1280 内税 ▲¥116\n内消費税等 ▲¥116', 'purchase', 1280, '116 0.6 count debit 0.3', '116 0.8 credit 0.5'],
  ['C66', 'Shop\nItem 24 $ 5\nTotal $ 5', 'purchase', 5, '24 0.8 debit 0', '='],
  ['C67', 'Laden\nBrot 1,00 € 2\nSumme 2,00 €', 'purchase', 2, '2 0.8 debit 0', '='],
  ['C68', 'Shop\nTax 8% 1.04\nTotal 13.04', 'purchase', 13.04, '13.04 0.5 debit 0', '='],
  ['C69', 'REFUND\nItem 12 -$5.00\nTax -$0.40\nTotal -$5.40', 'refund', 5.4, '5.4 0.6 count credit 0.5', '5.4 0.8 credit 0.5'],
  ['C70', 'REFUND\nQty 12 -$10.00', 'refund', 10, '10 0.6 count debit 0.3', '10 0.8 credit 0.5'],
  ['C71', 'Shop\nPack of 24 cans $5.00\nTotal $5.00', 'purchase', 5, '5 0.6 count debit 0', '5 0.8 debit 0'],
  ['C72', 'REFUND\nTOTAL 3 ITEMS -$2.50', 'refund', 2.5, '2.5 0.6 count debit 0.3', '2.5 0.8 credit 0.5'],
  ['C73', 'REFUND\n14:32 TOTAL -$10.00', 'refund', 10, '10 0.8 credit 0.5', '='],
  ['C75', 'Shop\nTotal $5.15 01/15/26', 'purchase', 5.15, '5.15 0.8 debit 0', '='],
  ['C76', '店\n合計 ¥538 お預り 1000 お釣り ¥462', 'purchase', 538, '538 0.6 count debit 0', '='],
  ['C77', 'Laden\nKaffee 2,50 € x2\nSumme 5,00 €', 'purchase', 5, '5 0.8 debit 0', '='],
  ['C78', 'Laden\nSumme 12,50 € 3 Artikel', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C79', 'Shop\nTOTAL USD 15 2 ITEMS', 'purchase', 15, '15 0.8 debit 0', '='],
  ['C80', 'Shop\nTotal 15 USD (2 items)', 'purchase', 15, '15 0.8 debit 0', '='],
  ['C81', 'Shop\nTotal ¥1,280 / USD 8.50', 'purchase', 1280, '1280 0.8 debit 0', '='],
  ['C82', '店\n合計 ¥1,080\n(8%対象 ¥1,080 内消費税 ¥80)', 'purchase', 1080, '1080 0.8 debit 0', '='],
  ['C83', '店\n合計 ¥2,180\n(8%対象 ¥1,080 内消費税 ¥80)\n(10%対象 ¥1,100 内消費税 ¥100)', 'purchase', 2180, '2180 0.8 debit 0', '='],
  ['C84', '店\nおにぎり ¥150\n合計 ¥162\n(税抜 ¥150)', 'purchase', 162, '162 0.8 debit 0', '='],
  ['C85', '店\n小計 ¥150\n(税抜)\n合計 ¥162', 'purchase', 162, '162 0.8 debit 0', '='],
  ['C86', '가게\n합계 ₩5,900\n(부가세 포함 ₩536)', 'purchase', 5900, '5900 0.8 debit 0', '='],
  ['C87', 'Shop\nTotal $12.50 (incl. tax $1.00)', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C88', 'Shop\nCoffee (2 x $3.50) $7.00\nTotal $7.00', 'purchase', 7, '7 0.8 debit 0', '='],
  ['C89', 'Shop\nTotal $7.00 (2 @ $3.50)', 'purchase', 7, '7 0.8 debit 0', '='],
  ['C90', 'REFUND\nItem -$20.00\nTax -$5.00\nRefund (to VISA $25.00)', 'refund', 25, '20 0.6 aside credit 0.5', '='],
  ['C91', '店\nコーヒー 2 ¥360\n合計 2点 ¥360\nお預り ¥1,000\nお釣り ¥640', 'purchase', 360, '1000 0.8 debit 0', '='],
  ['C92', '店\n合計 3点 980\n内税 ¥72', 'purchase', 980, '72 0.8 debit 0', '='],
  ['C93', '店\nおにぎり ¥168\nお茶 ¥151\n合計 319 (内税 ¥23)', 'purchase', 319, '319 0.8 debit 0', '168 0.8 debit 0'],
  ['C94', '店\nおにぎり ¥168\nお茶 ¥151\n合計 319 内税¥23', 'purchase', 319, '168 0.6 count debit 0', '168 0.8 debit 0'],
  ['C95', 'Rest\nTotal 48 Tip $8\nSteak $30.00', 'purchase', 48, '30 0.6 count debit 0', '30 0.8 debit 0'],
  ['C96', 'Shop\nBurger $8.00\nFries $3.04\nSubtotal $11.04\nTotal 12 Tax $0.96', 'purchase', 12, '11.04 0.6 count debit 0', '11.04 0.8 debit 0'],
  ['C97', '店\n珍珠奶茶 $50\n雞排 $70\n總計 120 找零 $80', 'purchase', 120, '80 0.6 count debit 0', '80 0.8 debit 0'],
  ['C98', '店\n總計 $170\n現金 200 找零 $30', 'purchase', 170, '170 0.6 count debit 0', '170 0.8 debit 0'],
  ['C99', 'Shop\nTotal 12 Tax $0.96\nCash $20.00\nChange $8.00', 'purchase', 12, '12 0.6 tender debit 0', '20 0.8 debit 0'],
  ['C100', '店\n合計 538 内税 ¥39\nお預り ¥1,000\nお釣り ¥462', 'purchase', 538, '538 0.6 tender debit 0', '1000 0.8 debit 0'],
  ['C101', 'Shop\nTotal 48 Tip $8\nCash $50.00\nChange $2.00', 'purchase', 48, '48 0.6 tender debit 0', '50 0.8 debit 0'],
  ['C102', 'Shop\nTotal $12.00\nCash $20.00 Change 8', 'purchase', 12, '12 0.6 tender debit 0', '20 0.8 debit 0'],
  ['C103', '店\n合計 ¥538\nお預り ¥1,000 お釣り 462', 'purchase', 538, '538 0.6 tender debit 0', '1000 0.8 debit 0'],
  ['C104', 'Shop\nTotal 319 Tax $25.52\nCash $1000.00\nChange $681.00', 'purchase', 319, '681 0.6 tender debit 0', '1000 0.8 debit 0'],
  ['C105', '店\n合計 980円 内税 ¥72\n内消費税等 ¥72', 'purchase', 980, '72 0.6 count debit 0', '72 0.8 debit 0'],
  ['C106', '店\nおにぎり ¥168\n小計 ¥168\n合計 181円 外税 ¥13', 'purchase', 181, '168 0.6 count debit 0', '168 0.8 debit 0'],
  ['C107', 'Shop\nItem $8.00\nSubtotal $8.00\nTotal 9, Tax $1.00', 'purchase', 9, '8 0.6 count debit 0', '8 0.8 debit 0'],
  ['C108', 'Shop\nTotal 12 / Tax $0.96\nTax $0.96', 'purchase', 12, '0.96 0.6 count debit 0', '0.96 0.8 debit 0'],
  ['C109', 'Shop\nItem $8.00\nSubtotal $8.00\nTotal: 9 | Tax: $1.00', 'purchase', 9, '8 0.6 count debit 0', '8 0.8 debit 0'],
  ['C110', '店\n總計 120元 稅 $6\n營業稅 $6', 'purchase', 120, '6 0.6 count debit 0', '6 0.8 debit 0'],
  ['C111', '가게\n합계 900원 부가세 ₩82\n부가세 ₩82', 'purchase', 900, '82 0.6 count debit 0', '82 0.8 debit 0'],
  ['C112', 'Shop\nTotal 12, Coupon -$3.00\nYou saved -$3.00', 'purchase', 12, '3 0.6 count debit 0.3', '3 0.8 credit 0.5'],
  ['C113', '店\n合計 980円 値引 ▲¥100\n値引合計 ▲¥100', 'purchase', 980, '100 0.6 count debit 0.3', '100 0.8 credit 0.5'],
  ['C114', 'Shop\nCoffee $ 4\nMuffin $ 4\nTotal 2 $ 8', 'purchase', 8, '8 0.8 debit 0', '2 0.8 debit 0'],
  ['C115', '店\nおにぎり ¥ 150\nお茶 ¥ 150\n合計 2 ¥ 300', 'purchase', 300, '300 0.8 debit 0', '2 0.8 debit 0'],
  ['C116', 'Shop\nTOTAL 2 $ 15', 'purchase', 15, '15 0.8 debit 0', '2 0.8 debit 0'],
  ['C117', 'Shop\nCoffee 2 $ 5', 'purchase', 5, '5 0.8 debit 0', '2 0.8 debit 0'],
  ['C118', 'Shop\nTotal 32\n14:32 Card -$32.00', 'purchase', 32, '32 0.8 debit 0.3', '32 0.8 credit 0.5'],
  ['C119', 'Shop\nPack of 3 cans $2.00\nTotal $5.00', 'purchase', 5, '3 0.6 tender debit 0', '5 0.8 debit 0'],
  ['C120', 'Shop\nTotal 12 $0.96\nTax $0.96', 'purchase', 12, '0.96 0.8 debit 0', '='],
  ['C121', 'Shop\nItem $11.04\nSubtotal $11.04\nTotal 12 $0.96', 'purchase', 12, '11.04 0.8 debit 0', '='],
  ['C122', 'Shop\nItem $8.00\nSubtotal $8.00\nTax $1.00 Total 9', 'purchase', 9, '8 0.6 count debit 0', '8 0.8 debit 0'],
  ['C123', '店\n内税 ¥72 合計 980\n内消費税等 ¥72', 'purchase', 980, '72 0.6 count debit 0', '72 0.8 debit 0'],
  ['C124', '가게\n부가세 ₩82 합계 900\n부가세 ₩82', 'purchase', 900, '82 0.6 count debit 0', '82 0.8 debit 0'],
  ['C125', '店\n値引 ▲¥100 合計 980\n値引合計 ▲¥100', 'purchase', 980, '100 0.6 count debit 0.3', '100 0.8 credit 0.5'],
  ['C126', 'Shop\nTotal 12 ... Tax $0.96\nTax $0.96', 'purchase', 12, '0.96 0.6 count debit 0', '0.96 0.8 debit 0'],
  ['C127', 'Shop\nTotal 120 8% Tax $9.60\nTax $9.60', 'purchase', 120, '9.6 0.6 count debit 0', '9.6 0.8 debit 0'],
  ['C128', 'Shop\nCoffee $8\nSubtotal $8\nTotal 9\nTax $1 VISA 9', 'purchase', 9, '8 0.6 count debit 0', '8 0.8 debit 0'],
  ['C129', 'Shop\nTax $0.96 Total 12\nCash $20.00\nChange $8.00', 'purchase', 12, '12 0.6 tender debit 0', '20 0.8 debit 0'],
  ['C130', 'Shop\nItem $8.00\nSubtotal $8.00\nTax $1.00 Total 9\nCash $20.00\nChange $11.00', 'purchase', 9, '11 0.6 tender debit 0', '20 0.8 debit 0'],
  ['C131', 'Shop\nDate: 28.09 26 Total: $12.50', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C132', 'Shop\nDate: 28.09/26 Total: $12.50', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C133', 'Laden\n25.12 25 Summe 12,50 €', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C134', 'Shop\nCoupon -$3.00\nTotal 12 Tax $0.96', 'purchase', 12, '3 0.6 count debit 0.3', '3 0.8 credit 0.5'],
  ['C135', 'Shop\nTax $0.96 Total 12\nYou saved -$3.00', 'purchase', 12, '3 0.6 count debit 0.3', '3 0.8 credit 0.5'],
  ['C136', 'REFUND\nItem -$11.04\nTax -$0.96 Total 12', 'refund', 12, '11.04 0.6 count debit 0.3', '11.04 0.8 credit 0.5'],
  ['C137', 'Shop\nLatte 2 $8\nTotal 9\nTax $1\nCash $10\nChange $1', 'purchase', 9, '10 0.8 debit 0', '='],
  ['C138', 'Shop\nEggs 500ml $10.86\nSubtotal $10.86\nTotal 11.73\nTax $0.87', 'purchase', 11.73, '10.86 0.8 debit 0', '='],
  ['C139', 'Shop\nBread 2 24,16 €\nTotal 24,16\nCash 50,00 €\nChange 25,84 €', 'purchase', 24.16, '50 0.8 debit 0', '='],
  ['C140', 'Shop\nCoffee 350g $168\nSubtotal $168\nTotal 185 USD\nTax $17', 'purchase', 185, '168 0.6 tender debit 0', '='],
  ['C141', '店\n21/07 24\n라떼 (12) ₩60\n케이크 Qty 4 ₩20\n케이크 ₩8\n소계 ₩88\n결제금액 ₩88\n받은돈 ₩100\n거스름돈 12', 'purchase', 88, '100 0.8 debit 0', '='],
  ['C142', 'Shop\nMilk $17.76\nDate: 08/16/25 06:54 Amount Due: $19.18\nTax 8% $1.42\nCASH $20.00\nCHANGE DUE 0.82', 'purchase', 19.18, '20 0.8 debit 0', '='],
  ['C143', 'Shop\nDate: 28.09,26 Total: $12.50', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C144', 'REFUND\nDate: 28,09.26 Total: -$12.50', 'refund', 12.5, '12.5 0.8 credit 0.5', '='],
  ['C145', 'Shop\nDate: 05/09.26 Total: $8.00', 'purchase', 8, '8 0.8 debit 0', '='],
  ['C146', 'Shop\nDate: 28.09//26 Total: $12.50', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C147', 'Laden\n24,01 24 Summe 12,50 €', 'purchase', 12.5, '12.5 0.8 debit 0', '='],
  ['C148', 'REFUND\nDate: 21/01-24 Total: -$45.00', 'refund', 45, '45 0.8 credit 0.5', '='],
  ['C149', 'REFUND\n28.09 26\nItem -12.50\nTotal -12.50', 'refund', 12.5, '12.5 0.5 credit 0.5', '28.09 0.5 debit 0'],
  ['C150', 'Shop\nTotal $38.01 01 01 24', 'purchase', 38.01, '38.01 0.8 debit 0', '='],
  ['C151', 'Shop\nItem 1 $3.00\nCoupon -$1.00\nTotal $2.00', 'purchase', 2, '3 0.8 debit 0', '='],
  ['C152', 'Shop\nItem 1 $3.00\nYou saved $1.00\nTotal $2.00', 'purchase', 2, '3 0.8 debit 0', '='],
  ['C153', 'Shop\nItem 1 $3.00\nDiscount ($1.00)\nTotal $2.00', 'purchase', 2, '3 0.8 debit 0', '='],
  ['C154', 'Shop\nWater 500ml $288\nTea $100\nTotal 388 Card $388', 'purchase', 388, '388 0.6 count debit 0', '388 0.8 debit 0'],
  ['C155', 'Shop\nItem 1 $25.00\nGift card -$10.00\nTotal $15.00', 'purchase', 15, '25 0.8 debit 0', '='],
  ['C156', 'Shop\nTea $2.00\nBagel $4.50 x2\n1/13/24 Total 45.00', 'purchase', 45, '4.5 0.8 debit 0', '='],
  ['C157', 'REFUND\nTea -$2.00\nBagel -$4.50 x2\n1/13/24 Total -45.00', 'refund', 45, '4.5 0.8 credit 0.5', '='],
  ['C158', 'Laden\nBrot 1 €2,10\nKaffee 2 x 5,10 10,20\nSumme 10,20', 'purchase', 10.2, '2.1 0.8 debit 0', '='],
  ['C159', 'REFUND\n13.01.\n24\nItem -4.50\nTotal -4.50', 'refund', 4.5, '13.01 0.5 debit 0', '='],
  ['C160', 'Shop\nItem 4.50\nTotal 4.50 EUR 13.01.\n24', 'purchase', 4.5, '13.01 0.8 debit 0', '4.5 0.8 debit 0'],
  ['C161', 'Market 7\n23.01.27 JPY\nお茶 ¥150\n弁当 ¥480\n合計 ¥630', 'purchase', 630, '2301.27 0.8 debit 0', '='],
  ['C162', 'Market 7\n23.01.27\nREFUND\nItem -12.50\nTotal -12.50', 'refund', 12.5, '2301.27 0.5 debit 0', '='],
  ['C163', 'Shop\nItem 1 $10.00\nTotal $27.01 12/5/24', 'purchase', 27.01, '27.01 0.8 debit 0', '='],
  ['C164', 'Shop\nItem 1 $10.00\nTotal $27.01 12/5/24\nCash $50.00\nChange $22.99', 'purchase', 27.01, '27.01 0.6 tender debit 0', '='],
  ['C165', 'Shop\nItem $3\nTotal $3\nCard ****1234 $3 1/13/24', 'purchase', 3, '3 0.8 debit 0', '='],
  ['C166', 'Laden\nBrot 1 €2,10\nKaffee 2 x 5,10 10,20 €\nSumme 10,20 €', 'purchase', 10.2, '20 0.8 debit 0', '='],
  ['C167', 'Storno\nBrot 1 -€2,10\nKaffee 2 x 5,10 -10,20 €\nSumme -10,20 €', 'refund', 10.2, '20 0.8 debit 0', '='],
  ['C168', 'Shop\nItem 1 $10.00\nKaffee €2,10\nSumme (2) 12,10 €', 'purchase', 12.1, '10 0.8 debit 0', '='],
  ['C169', 'Shop\nSumme 184,73 EUR\n(IVA 5% €9,24) Points 1847', 'purchase', 184.73, '1847 0.8 debit 0', '184.73 0.8 debit 0'],
  ['C170', 'STORE #72\n13 .01/ 25 JPY\n弁当 480\n合計 2,499\nお預り 3,000\nお釣り 501', 'purchase', 2499, '3000 0.5 debit 0', '='],
  ['C171', 'Shop\n15.01.2026 14:32 EUR\nBrot 2,50\nKaffee 3,20\nSumme 5,70\nBar 10,00\nRückgeld 4,30', 'purchase', 5.7, '5.7 0.38 tender debit 0', '='],
  ['C172', 'Shop\nMilk 1 3.25', 'purchase', 3.25, '0 0 debit 0', '3.25 0.5 debit 0'],
  ['C173', 'Shop\nTotal $145.01 01 01 24', 'purchase', 145.01, '145.01 0.8 debit 0', '='],
  ['C174', 'Laden\nMilch 2 €13 24.07.24\nSumme €26,00', 'purchase', 26, '26 0.8 debit 0', '='],
  ['C175', 'REFUND\nItem 2 -$15 24.07.23\nTotal -$30', 'refund', 30, '30 0.8 credit 0.5', '='],
  ['C176', 'REFUND\nItem 1 -$10.00\nTotal -$27.01 01/13/25\nVISA $27.01', 'refund', 27.01, '27.01 0.8 debit 0.3', '='],
  ['C177', 'Shop\nItem 1 $10.00\nTotal $27.01 01/13/25\nCard -27.01 USD', 'purchase', 27.01, '27.01 0.8 debit 0.3', '='],
  ['C178', 'Shop\nTotal 12 = $0.96\nTax $0.96', 'purchase', 12, '0.96 0.8 debit 0', '='],
  ['C179', 'Storno\nBon 4711.13/01/25\nBrot -2,50\nSumme -12,50', 'refund', 12.5, '4711.13 0.5 debit 0', '='],
  ['C180', 'Shop\n13.01.\n2024 14:32 EUR\nItem $45.00\nTotal $45.00', 'purchase', 45, '2024 0.8 debit 0', '='],
];

/** Every line that is not an ISO date line becomes its label and its last figure. */
function split(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const parts = /^(.*\S)\s+(\S*\d\S*)$/u.exec(line);
      return parts && !/^\d{4}-\d\d-\d\d/.test(line) ? `${parts[1]}\n${parts[2]}` : line;
    })
    .join('\n');
}

function laidOut(text: string, layout: Layout): string {
  return layout === 'split' ? split(text) : text;
}

function read(text: string): string {
  const result = parseReceiptOcrText(text);
  const demotion = result.amountDemotion ? ` ${result.amountDemotion}` : '';
  return `${result.amount} ${result.amountConfidence}${demotion} ${result.direction} ${result.directionConfidence}`;
}

/** Every row whose reading has moved off its record, with what it reads now. */
function moved(rows: readonly Row[], layout: Layout): string[] {
  return rows.flatMap(([id, text, , , joined, splitReading]) => {
    const recorded = layout === 'split' && splitReading !== '=' ? splitReading : joined;
    const now = read(laidOut(text, layout));
    return now === recorded ? [] : [`${id} ${layout}: reads ${now}, recorded ${recorded}`];
  });
}

/**
 * ADR 0185's score: refunds read credit / twinned / debit 0, purchases read
 * debit 0 / twinned / credit, a correction for each wrong type and each wrong
 * amount, and the silent rows, wrong with neither the amount (under 0.7) nor
 * the type (over 0) flagged.
 */
function score(rows: readonly Row[], layout: Layout) {
  const refunds = [0, 0, 0];
  const purchases = [0, 0, 0];
  let corrections = 0;
  const silent: string[] = [];
  for (const [id, text, kind, amount] of rows) {
    const result = parseReceiptOcrText(laidOut(text, layout));
    const column = result.direction === 'credit' ? 0 : result.directionConfidence > 0 ? 1 : 2;
    if (kind === 'refund') {
      refunds[column]++;
    } else {
      purchases[2 - column]++;
    }
    const wrongType = (result.direction === 'credit') !== (kind === 'refund');
    const wrongAmount = amount !== null && Math.abs(result.amount - amount) >= 0.005;
    corrections += Number(wrongType) + Number(wrongAmount);
    if ((wrongType || wrongAmount) && result.amountConfidence >= 0.7 && result.directionConfidence === 0) {
      silent.push(id);
    }
  }
  return { refunds, purchases, corrections, silent };
}

/**
 * The rows read silently in the stricter sense ADR 0186 holds every change to:
 * a wrong amount graded 0.7 or more, whatever the direction's grade; a refund
 * read as a purchase graded 0; or a purchase read as a credit graded 0.5 or
 * more.
 */
function silentStrictly(rows: readonly Row[], layout: Layout): string[] {
  return rows.flatMap(([id, text, kind, amount]) => {
    const result = parseReceiptOcrText(laidOut(text, layout));
    const wrongAmount = amount !== null && Math.abs(result.amount - amount) >= 0.005;
    const silent =
      (wrongAmount && result.amountConfidence >= 0.7) ||
      (kind === 'refund' && result.direction === 'debit' && result.directionConfidence === 0) ||
      (kind === 'purchase' && result.direction === 'credit' && result.directionConfidence >= 0.5);
    return silent ? [id] : [];
  });
}

describe('the receipt battery (ADR 0185, ADR 0186)', () => {
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 9, 30, 12));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  for (const layout of ['joined', 'split'] as const) {
    it(`reads each of the sixty receipts as recorded, ${layout}`, () => {
      expect(moved(BATTERY, layout)).toEqual([]);
    });

    it(`reads the counterexamples of ADR 0185 and ADR 0186 as recorded, ${layout}`, () => {
      expect([...moved(ADR_0185, layout), ...moved(ADR_0186, layout)]).toEqual([]);
    });
  }

  it('scores the sixty joined: refunds 24 / 7 / 0, purchases 16 / 1 / 12, 31 corrections, no silent row', () => {
    expect(score(BATTERY, 'joined')).toEqual({
      refunds: [24, 7, 0],
      purchases: [16, 1, 12],
      corrections: 31,
      silent: [],
    });
  });

  it('scores the sixty split: refunds 28 / 3 / 0, purchases 16 / 1 / 12, 27 corrections, no silent row', () => {
    expect(score(BATTERY, 'split')).toEqual({
      refunds: [28, 3, 0],
      purchases: [16, 1, 12],
      corrections: 27,
      silent: [],
    });
  });

  it('leaves no counterexample of ADR 0185 silent', () => {
    expect([...score(ADR_0185, 'joined').silent, ...score(ADR_0185, 'split').silent]).toEqual([]);
  });

  it('leaves silent only the counterexamples ADR 0186 records as known gaps', () => {
    expect(score(ADR_0186, 'joined').silent).toEqual([
      'C36', 'C37', 'C40', 'C66', 'C91', 'C92', 'C120', 'C121', 'C137', 'C138', 'C139', 'C141',
      'C142', 'C151', 'C152', 'C153', 'C155', 'C156', 'C158', 'C160', 'C161', 'C166', 'C167',
      'C168', 'C169', 'C178', 'C180',
    ]);
    expect(score(ADR_0186, 'split').silent).toEqual([
      'C18', 'C19', 'C36', 'C37', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47', 'C48',
      'C49', 'C66', 'C91', 'C92', 'C93', 'C94', 'C95', 'C96', 'C97', 'C99', 'C100', 'C101', 'C102',
      'C103', 'C104', 'C105', 'C106', 'C107', 'C108', 'C109', 'C110', 'C111', 'C114', 'C115',
      'C116', 'C117', 'C120', 'C121', 'C122', 'C123', 'C124', 'C126', 'C127', 'C128', 'C129',
      'C130', 'C137', 'C138', 'C139', 'C141', 'C142', 'C151', 'C152', 'C153', 'C155', 'C156',
      'C158', 'C161', 'C166', 'C167', 'C168', 'C178', 'C180',
    ]);
  });

  it('leaves silent in the stricter sense only the rows it records', () => {
    expect(silentStrictly(BATTERY, 'joined')).toEqual([
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P12', 'P16', 'P34', 'P44', 'P45',
    ]);
    expect(silentStrictly(BATTERY, 'split')).toEqual([
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P12', 'P16', 'P34', 'P44', 'P45',
    ]);
    expect(silentStrictly(ADR_0185, 'joined')).toEqual(['X12', 'X13']);
    expect(silentStrictly(ADR_0185, 'split')).toEqual(['X6', 'X7', 'X12', 'X13']);
    expect(silentStrictly(ADR_0186, 'joined')).toEqual([
      'C30', 'C34', 'C35', 'C36', 'C37', 'C40', 'C66', 'C91', 'C92', 'C120', 'C121', 'C137', 'C138',
      'C139', 'C141', 'C142', 'C151', 'C152', 'C153', 'C155', 'C156', 'C157', 'C158', 'C159',
      'C160', 'C161', 'C162', 'C166', 'C167', 'C168', 'C169', 'C178', 'C179', 'C180',
    ]);
    expect(silentStrictly(ADR_0186, 'split')).toEqual([
      'C18', 'C19', 'C30', 'C34', 'C35', 'C36', 'C37', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45',
      'C46', 'C47', 'C48', 'C49', 'C53', 'C54', 'C65', 'C66', 'C91', 'C92', 'C93', 'C94', 'C95',
      'C96', 'C97', 'C99', 'C100', 'C101', 'C102', 'C103', 'C104', 'C105', 'C106', 'C107', 'C108',
      'C109', 'C110', 'C111', 'C112', 'C113', 'C114', 'C115', 'C116', 'C117', 'C118', 'C120',
      'C121', 'C122', 'C123', 'C124', 'C125', 'C126', 'C127', 'C128', 'C129', 'C130', 'C134',
      'C135', 'C136', 'C137', 'C138', 'C139', 'C141', 'C142', 'C149', 'C151', 'C152', 'C153',
      'C155', 'C156', 'C157', 'C158', 'C159', 'C161', 'C162', 'C166', 'C167', 'C168', 'C178',
      'C179', 'C180',
    ]);
  });
});
