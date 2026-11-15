---
id: l01-twos-complement
title: "Adding, [Two's Complement] and Overflow"
ref: Lecture 1
short: Two's complement and overflow
nav: Two's complement
strip:
  head: "Same sign in, other sign out: overflow"
  text: "The top bit of a two's complement word is worth minus the usual amount. Negate by inverting every bit and adding 1. A sum has overflowed when two numbers of one sign give an answer of the other sign. A carry out is not the same as overflow, so use the signs."
summary:
  - Add 0110 and 0111 in binary, showing the carries.
  - What are the column weights and the range of a 4-bit two's complement word?
  - How do you negate a two's complement number?
  - How do you spot overflow, and why is a carry out of the top bit not the same thing?
---

:::intro
Binary sums work column by column, just like decimal ones. Two's complement then stores negative numbers, and overflow is the trap to watch for when adding them. :src[D s4-6]
:::

## Add **Column by Column** and Carry a 1 When a Column Reaches Two

1. Start at the right and work left, exactly as in decimal. $0 + 0 = 0$ and $0 + 1 = 1$. :src[D s4]
2. $1 + 1 = 10$: **write 0 and carry 1**. With a carry coming in as well, $1 + 1 + 1 = 11$: **write 1 and carry 1**. :src[D s4] :check[l01-add]
3. A carry **out of the top column** has nowhere to go: it does not fit in the word. :src[D s4]

::::example{src="D s4; derived" check=l01-add}
Work out 0110 + 0111 in 4 bits.

:::step[Right half]
$0 + 1 = 1$, write **1**. Then $1 + 1 = 10$, write **0** and carry 1 into the 4s column.
:::

:::step[Left half]
$1 + 1 + 1 = 11$, write **1** and carry 1. Then $0 + 0 + 1 = 1$, write **1**. Nothing is carried out of the top.
:::

:::step[Check]
The answer is **1101**, which is $8 + 4 + 1 = 13$, and $6 + 7 = 13$.
:::
::::

## Two's Complement Gives the Top Bit a **Negative** Weight

:::figbox{name=l01_wheel w=188px src="D s5; derived" check=l01-twos}
:::

1. To store **signed** numbers, the top bit of an $n$-bit word is given the weight $-2^{n-1}$ instead of $2^{n-1}$. The other columns keep their usual weights. :src[D s5]
2. With 4 bits the weights are $-8$, 4, 2, 1, so the **range** is $-8$ to 7. A pattern whose top bit is 1 is **negative**. :src[D s5] :check[l01-twos]
3. To **negate** a number, **invert every bit, then add 1**. :src[D s5]
4. For example, 5 is 0101. Inverting gives 1010, and adding 1 gives **1011**, which is $-8 + 2 + 1 = -5$. :src[D s5] :check[l01-twos]
5. The wheel shows all sixteen 4-bit patterns. Adding 1 moves one step clockwise, and the only **join** is between 0111 (7) and 1000 ($-8$). :src[derived] :check[l01-twos]

## Overflow Means the True Answer Is **Outside the Range**

:::note{w=176px .mistake}
COMMON MISTAKE<br>A carry out of the top bit is **not** overflow. Look at the signs instead.
:::

1. A sum **overflows** when the true answer is outside the range the word can hold. :src[D s6]
2. The test: if you add two numbers of the **same sign** and the answer has the **other sign**, it overflowed. :src[D s6] :check[l01-overflow]
3. $0101 + 0100 = 1001$: two positive numbers, 5 and 4, appear to give $-7$. That is **overflow**, because 9 is more than 7. :src[D s6] :check[l01-overflow]
4. $1111 + 0001 = 0000$ with a carry out of the top. But $-1 + 1 = 0$ is **correct**: the signs differed, so it cannot overflow. :src[D s6] :check[l01-overflow]

:::table{src="D s6; EX p1; derived" widths="30% 15% 22% *"}
| Sum (4-bit) | Result | Carry out? | Overflow? |
|---|---|---|---|
| $0111 + 0001$ ($7 + 1$) | 1000 | no | **yes**: two positives gave $-8$ |
| $1000 + 1111$ ($-8 + -1$) | 0111 | yes | **yes**: two negatives gave 7 |
| $1100 + 0011$ ($-4 + 3$) | 1111 | no | no: the signs differ, answer $-1$ |
| $0101 + 1101$ ($5 + -3$) | 0010 | yes | no: the signs differ, answer 2 |
:::

5. The table works through four more sums. In the last one, $5 + -3$ carries out of the top and still gives the right answer, 2: that is how **subtraction** is done, by adding the negated number. :src[EX p1; derived] :check[l01-overflow]

:::warmup
- Q: Work out 0011 + 0110 in 4-bit binary, and give the answer in decimal.
  A: 1001, which is 9 as an unsigned number ($3 + 6$).
- Q: Write $-3$ in 4-bit two's complement.
  A: 3 is 0011. Invert to get 1100, add 1 to get 1101. Check: $-8 + 4 + 1 = -3$.
- Q: What are the smallest and largest values of a 6-bit two's complement word?
  A: $-32$ and 31: the top bit is worth $-2^5$.
- Q: Does 0110 + 0011 overflow in 4-bit two's complement? How can you tell?
  A: Yes. Both are positive (6 and 3) but the result, 1001, is negative ($-7$).
:::
