---
id: l01-place-value
title: "Binary [Place Value] and Conversion"
ref: Lecture 1
short: Place value and conversion
nav: Place value
strip:
  head: Columns double, remainders come out backwards
  text: "Going left, each binary column is worth twice the last one. To convert a decimal number, keep halving it and read the remainders from the last one back to the first, then check by adding up the columns."
summary:
  - What is each column worth in base 2, and how many values can n bits show?
  - Convert 13 to binary by repeated division, and check it by place value.
---

:::intro
This page is about reading a row of bits as a whole number, and writing a whole number as a row of bits. Both come down to knowing what each column is worth. :src[D s2-3]
:::

## Each Binary Column Is Worth **Twice** the Column to Its Right

:::figbox{name=l01_columns w=250px src="D s2; derived" check=l01-place-value}
:::

1. In base 10, each column is worth **ten** times the column to its right: units, tens, hundreds. :src[D s2]
2. In base 2, each column is worth **twice** the column to its right. Reading from the right, the columns are worth 1, 2, 4, 8, and so on. :src[D s2]
3. To read a binary number, **add up the columns that hold a 1**. So 1011 is $8 + 0 + 2 + 1 = 11$. :src[D s2] :check[l01-place-value]
4. A pattern of $n$ bits can show $2^n$ **different values**, which run from 0 up to $2^n - 1$. Four bits count from 0 to 15, and eight bits count from 0 to 255. :src[D s2] :check[l01-place-value]

:::note{w=180px .mistake}
COMMON MISTAKE<br>The biggest value is $2^n - 1$, not $2^n$: one of the $2^n$ patterns is used up by zero.
:::

5. The largest value is the pattern of **all ones**. With five bits that is 11111, which is $16 + 8 + 4 + 2 + 1 = 31$, one less than $2^5 = 32$. :src[D s2; derived] :check[l01-place-value]

6. Each **extra bit doubles** the number of values, because every old pattern can now have a 0 or a 1 put in front of it. That is why 8 bits give 256 values but 16 bits give 65,536. :src[D s2; derived] :check[l01-place-value]

## To Convert to Binary, **Halve** Until You Reach Zero

1. **Divide by 2** again and again, writing down the **remainder** each time (it is always 0 or 1). :src[D s3]
2. **Stop** when the quotient reaches 0. :src[D s3]
3. Read the remainders **from the last one back to the first**. The first remainder you wrote is the units column, so it goes on the right. :src[D s3; derived] :check[l01-convert]
4. **Check** the answer by place value, as the lecture does: add up the columns that hold a 1. :src[D s3]

::::example{src="D s3; EX p1; derived" check=l01-convert}
Convert 22 to binary, and check the answer.

:::step[Halve]
$22 \div 2 = 11$ remainder **0**. $11 \div 2 = 5$ remainder **1**. $5 \div 2 = 2$ remainder **1**.
:::

:::step[To zero]
$2 \div 2 = 1$ remainder **0**. $1 \div 2 = 0$ remainder **1**. The quotient is 0, so stop.
:::

:::step[Backwards]
The remainders in the order written are 0, 1, 1, 0, 1. Read from the last to the first: **10110**.
:::

:::step[Check]
The columns are 16, 8, 4, 2, 1, so 10110 is $16 + 0 + 4 + 2 + 0 = 22$. It matches.
:::
::::

:::table{src="D s3" widths="22% 26% 26% *"}
| Divide | Quotient | Remainder | Column it fills |
|---|---|---|---|
| $13 \div 2$ | 6 | 1 | 1s (rightmost) |
| $6 \div 2$ | 3 | 0 | 2s |
| $3 \div 2$ | 1 | 1 | 4s |
| $1 \div 2$ | 0 | 1 | 8s (leftmost) |
:::

5. The table is the lecture's example: 13 gives remainders 1, 0, 1, 1, which read backwards are **1101**, and $8 + 4 + 0 + 1 = 13$. :src[D s3] :check[l01-convert]

:::warmup
- Q: What is 1011 in decimal?
  A: $8 + 0 + 2 + 1 = 11$.
- Q: How many different values can 8 bits show, and what is the largest?
  A: $2^8 = 256$ values, from 0 up to 255.
- Q: Convert 6 to binary by repeated division.
  A: $6 \div 2 = 3$ r 0, $3 \div 2 = 1$ r 1, $1 \div 2 = 0$ r 1. Read backwards: 110.
- Q: Convert 37 to binary and check it.
  A: The remainders are 1, 0, 1, 0, 0, 1, so 37 is 100101. Check: $32 + 4 + 1 = 37$.
- Q: What is the largest value 5 bits can show, and what does its pattern look like?
  A: 31, which is 11111: every column holds a 1.
- Q: Why are the remainders read from the last back to the first?
  A: The first remainder is the units column, which is written on the right.
:::
