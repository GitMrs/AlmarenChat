#!/usr/bin/env python3
import argparse
import csv
import html
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path


def workspace_path(value: str, *, suffix: str, must_exist: bool = False) -> Path:
    workspace = Path.cwd().resolve()
    candidate = (workspace / value).resolve()
    try:
        candidate.relative_to(workspace)
    except ValueError as error:
        raise ValueError(f"路径超出工作区：{value}") from error
    if candidate.suffix.lower() != suffix:
        raise ValueError(f"路径必须使用 {suffix} 扩展名：{value}")
    if must_exist and not candidate.is_file():
        raise ValueError(f"输入文件不存在：{value}")
    return candidate


def money(value: Decimal) -> str:
    return f"{value:,.2f}"


def load_sales(input_path: Path):
    product_totals = defaultdict(Decimal)
    monthly_totals = defaultdict(Decimal)
    anomalies = []
    total = Decimal("0")

    with input_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"date", "product", "amount"}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV 缺少必要列：{', '.join(sorted(missing))}")

        for row_number, row in enumerate(reader, start=2):
            date_text = (row.get("date") or "").strip()
            product = (row.get("product") or "").strip()
            amount_text = (row.get("amount") or "").strip()
            reasons = []
            try:
                date = datetime.strptime(date_text, "%Y-%m-%d")
            except ValueError:
                date = None
                reasons.append("日期格式无效")
            if not product:
                reasons.append("产品名称为空")
            try:
                amount = Decimal(amount_text)
            except InvalidOperation:
                amount = None
                reasons.append("销售额不是数字")
            if amount is not None and amount <= 0:
                reasons.append("销售额非正数")

            if reasons:
                anomalies.append((row_number, date_text, product, amount_text, "、".join(reasons)))
            if date is None or not product or amount is None or amount <= 0:
                continue

            total += amount
            product_totals[product] += amount
            monthly_totals[date.strftime("%Y-%m")] += amount

    return total, product_totals, monthly_totals, anomalies


def monthly_change(monthly_totals):
    months = sorted(monthly_totals)
    if len(months) < 2:
        return None
    previous, current = months[-2:]
    previous_total = monthly_totals[previous]
    current_total = monthly_totals[current]
    rate = None if previous_total == 0 else (current_total - previous_total) / previous_total * Decimal("100")
    return previous, current, previous_total, current_total, rate


def markdown_report(total, product_totals, monthly_totals, anomalies):
    change = monthly_change(monthly_totals)
    product_rows = "\n".join(
        f"| {name} | {money(amount)} |" for name, amount in sorted(product_totals.items(), key=lambda item: (-item[1], item[0]))
    ) or "| 无有效数据 | 0.00 |"
    if change:
        previous, current, previous_total, current_total, rate = change
        rate_text = "无法计算" if rate is None else f"{rate:+.2f}%"
        change_text = f"{previous} 为 {money(previous_total)}，{current} 为 {money(current_total)}，环比 {rate_text}。"
    else:
        change_text = "有效数据不足两个月，无法计算环比。"
    anomaly_rows = "\n".join(
        f"| {row} | {date or '-'} | {product or '-'} | {amount or '-'} | {reason} |"
        for row, date, product, amount, reason in anomalies
    ) or "| - | - | - | - | 未发现异常 |"
    return f"""# 销售数据分析

## 总销售额

{money(total)}

## 产品汇总

| 产品 | 销售额 |
| --- | ---: |
{product_rows}

## 月度变化

{change_text}

## 异常记录

| CSV 行号 | 日期 | 产品 | 销售额 | 原因 |
| ---: | --- | --- | ---: | --- |
{anomaly_rows}
"""


def html_report(total, product_totals, monthly_totals, anomalies):
    change = monthly_change(monthly_totals)
    products = "".join(
        f"<tr><td>{html.escape(name)}</td><td>{money(amount)}</td></tr>"
        for name, amount in sorted(product_totals.items(), key=lambda item: (-item[1], item[0]))
    ) or '<tr><td>无有效数据</td><td>0.00</td></tr>'
    if change:
        previous, current, previous_total, current_total, rate = change
        rate_text = "无法计算" if rate is None else f"{rate:+.2f}%"
        change_text = f"{previous} 为 {money(previous_total)}，{current} 为 {money(current_total)}，环比 {rate_text}。"
    else:
        change_text = "有效数据不足两个月，无法计算环比。"
    anomaly_rows = "".join(
        "<tr>"
        f"<td>{row}</td><td>{html.escape(date or '-')}</td><td>{html.escape(product or '-')}</td>"
        f"<td>{html.escape(amount or '-')}</td><td>{html.escape(reason)}</td>"
        "</tr>"
        for row, date, product, amount, reason in anomalies
    ) or '<tr><td colspan="5">未发现异常</td></tr>'
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>销售数据分析</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; color: #172033; background: #f4f6f8; }}
    main {{ width: min(960px, calc(100% - 32px)); margin: 32px auto; }}
    h1, h2 {{ letter-spacing: 0; }}
    section {{ margin-top: 20px; padding: 20px; border: 1px solid #dfe3e8; background: white; }}
    .metric {{ font-size: 32px; font-weight: 750; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ padding: 10px; border-bottom: 1px solid #e7e9ec; text-align: left; }}
    th {{ background: #f7f8fa; }}
    td:nth-child(2) {{ font-variant-numeric: tabular-nums; }}
    @media (max-width: 600px) {{ main {{ width: 100%; margin: 0; }} section {{ margin-top: 8px; border-width: 1px 0; }} }}
  </style>
</head>
<body>
  <main>
    <h1>销售数据分析</h1>
    <section><h2>总销售额</h2><div class="metric">{money(total)}</div></section>
    <section><h2>产品汇总</h2><table><thead><tr><th>产品</th><th>销售额</th></tr></thead><tbody>{products}</tbody></table></section>
    <section><h2>月度变化</h2><p>{html.escape(change_text)}</p></section>
    <section><h2>异常记录</h2><table><thead><tr><th>行号</th><th>日期</th><th>产品</th><th>销售额</th><th>原因</th></tr></thead><tbody>{anomaly_rows}</tbody></table></section>
  </main>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description="分析销售 CSV 并生成 Markdown 和 HTML 报告")
    parser.add_argument("--input", required=True)
    parser.add_argument("--markdown-output", required=True)
    parser.add_argument("--html-output", required=True)
    args = parser.parse_args()

    input_path = workspace_path(args.input, suffix=".csv", must_exist=True)
    markdown_path = workspace_path(args.markdown_output, suffix=".md")
    html_path = workspace_path(args.html_output, suffix=".html")
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.parent.mkdir(parents=True, exist_ok=True)

    data = load_sales(input_path)
    markdown_path.write_text(markdown_report(*data), encoding="utf-8")
    html_path.write_text(html_report(*data), encoding="utf-8")
    print(f"generated {args.markdown_output} and {args.html_output}")


if __name__ == "__main__":
    main()
