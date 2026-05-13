export type FinanceCategory = {
  key: "income" | "expense" | "receivable" | "payable";
  label: string;
  amount: number;
};

export type FinanceItem = {
  type: string;
  label: string;
  amount: number;
};

export const financeCategories: FinanceCategory[] = [
  { key: "income", label: "收入", amount: 5540 },
  { key: "expense", label: "支出", amount: 5120.13 },
  { key: "receivable", label: "应收款", amount: 50 },
  { key: "payable", label: "应付款", amount: 6422.42 },
];

export const largestItems: FinanceItem[] = [
  { type: "应付款", label: "苹东家宴 樊总垫付", amount: 2753 },
  { type: "支出", label: "8月10号 瑞福春", amount: 1432 },
  { type: "应付款", label: "樊总支付麦当劳", amount: 1046.4 },
  { type: "支出", label: "王磊奖金", amount: 1000 },
];

export const financeSummary = {
  rowCount: 86,
  balance: -5952.55,
  totalPositive: 5590,
  totalNegative: 11542.55,
};
