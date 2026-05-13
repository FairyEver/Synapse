export const formatMoney = (value: number): string =>
  value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const formatPercent = (value: number): string =>
  `${Math.round(value * 10) / 10}%`;
