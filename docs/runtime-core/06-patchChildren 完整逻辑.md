# patchChildren 完整逻辑分析

> 源码位置：`packages/runtime-core/src/renderer.ts`

## 在 diff 流程中的位置

`patchChildren` 不是 diff 核心本身，而是 **diff 之前的"分流路由器"**——它根据新旧 children 的类型组合，决定走哪条路。

整体调用链如下：

```
patchElement
  ├── 有 dynamicChildren?
  │     └── ✅ patchBlockChildren    → 只 patch 动态节点（扁平 for 循环，不需要 diff）
  │
  ├── 没有 dynamicChildren
  │     └── patchChildren           → "路由器"，根据类型分流
  │           ├── 新旧都是数组 + 有 key
  │           │     └── patchKeyedChildren   → 5步 + LIS（真正的 diff 核心）
  │           ├── 新旧都是数组 + 无 key
  │           │     └── patchUnkeyedChildren → 按索引硬比较
  │           └── 其他情况
  │                 └── 直接 setText / mount / unmount
  │
  └── patchFlag 处理 props
        ├── CLASS → 只更新 class
        ├── STYLE → 只更新 style
        ├── PROPS → 只更新动态 props
        ├── TEXT  → 只更新文本
        └── FULL_PROPS → 全量 diff props
```

---

## patchElement 源码流程概览

在进入 `patchChildren` 之前，`patchElement` 会先判断是否有编译时优化的快速通道：

```ts
const patchElement = (n1, n2, parentComponent, ...) => {
  const el = (n2.el = n1.el!)
  let { patchFlag, dynamicChildren, dirs } = n2

  // ① 有 dynamicChildren → 走 Block 快速通道
  if (dynamicChildren) {
    patchBlockChildren(n1.dynamicChildren!, dynamicChildren, el, ...)
  }
  // ② 没有 → 完整 diff children
  else if (!optimized) {
    patchChildren(n1, n2, el, null, parentComponent, ...)
  }

  // ③ patchFlag 处理 props（CLASS / STYLE / PROPS / TEXT 等）
  if (patchFlag > 0) {
    if (patchFlag & PatchFlags.FULL_PROPS) { patchProps(...) }
    else {
      if (patchFlag & PatchFlags.CLASS) { /* 只更新 class */ }
      if (patchFlag & PatchFlags.STYLE) { /* 只更新 style */ }
      if (patchFlag & PatchFlags.PROPS) { /* 只更新动态 props */ }
    }
    if (patchFlag & PatchFlags.TEXT) { /* 只更新文本 */ }
  }

  // ④ 异步执行 updated 钩子
}
```

---

## patchChildren 源码逻辑

children 只有 3 种可能：**文本（Text）、数组（Array）、空（null）**，新旧组合就是 3×3 = 9 种情况。

### 第一关：快速通道（patchFlag 判断）

编译器如果已经标记了 fragment 类型，直接分流，不用再判断 shapeFlag：

```ts
if (patchFlag > 0) {
  if (patchFlag & PatchFlags.KEYED_FRAGMENT) {
    // 有 key 的 fragment（如 v-for + :key）
    patchKeyedChildren(...)
    return
  } else if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) {
    // 无 key 的 fragment（如 v-for 没写 key）
    patchUnkeyedChildren(...)
    return
  }
}
```

### 第二关：9 种组合分流

如果没走快速通道，就靠 `shapeFlag` 位运算判断新旧 children 类型：

```
              ┌──────────────────────────────────────────────────┐
              │           新 children (n2)                        │
              ├──────────────┬───────────────┬───────────────────┤
              │  Text        │   Array       │    null           │
┌─────┬───────┼──────────────┼───────────────┼───────────────────┤
│     │ Array │ ① 卸载旧数组  │ ③ 完整 diff   │ ④ 卸载旧数组      │
│ 旧  │       │   设置新文本  │ KeyedChildren │   unmountChildren │
│     ├───────┼──────────────┼───────────────┼───────────────────┤
│ n1  │ Text  │ ② 直接       │ ⑤ 清空旧文本  │ ⑥ 清空旧文本      │
│     │       │   替换文本    │   挂载新数组   │                   │
│     ├───────┼──────────────┼───────────────┼───────────────────┤
│     │ null  │ ⑦ 设置新文本  │ ⑧ 挂载新数组  │ ⑨ 啥也不干        │
└─────┴───────┴──────────────┴───────────────┴───────────────────┘
```

**9 种情况中，只有第 ③ 种（旧数组 → 新数组）才会走 `patchKeyedChildren`（真正的 diff 算法）。其他情况都很简单：要么直接替换文本，要么整体卸载/挂载。**

对应源码：

```ts
if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
  // === 新的是文本 ===
  if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    // ① 旧数组 → 新文本：先卸载旧数组
    unmountChildren(c1)
  }
  if (c2 !== c1) {
    // ①②⑦ 统一处理：设置新文本
    hostSetElementText(container, c2)
  }
} else {
  // === 新的是数组或 null ===
  if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    // 旧的是数组
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      // ③ 旧数组 → 新数组：完整 diff！唯一走真正 diff 的路径
      patchKeyedChildren(...)
    } else {
      // ④ 旧数组 → 新null：卸载旧的
      unmountChildren(c1)
    }
  } else {
    // 旧的是文本或 null
    if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
      // ⑤⑥ 旧文本存在：先清空
      hostSetElementText(container, '')
    }
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      // ⑤⑧ 新的是数组：挂载
      mountChildren(c2)
    }
  }
}
```

---

## patchUnkeyedChildren（无 key 的简单 diff）

没有 key 的情况，不做任何移动操作，按索引硬对比：

```ts
const patchUnkeyedChildren = (c1, c2, ...) => {
  const oldLength = c1.length
  const newLength = c2.length
  const commonLength = Math.min(oldLength, newLength)

  // 公共长度内：逐个 patch
  for (i = 0; i < commonLength; i++) {
    patch(c1[i], c2[i], ...)
  }

  if (oldLength > newLength) {
    // 旧的多 → 删掉多余的
    unmountChildren(c1, ..., commonLength)
  } else {
    // 新的多 → 挂载新增的
    mountChildren(c2, ..., commonLength)
  }
}
```

这就是 `v-for` 不写 key 时性能差的原因——它无法复用移动了位置的节点，只能逐个替换内容。

---

## patchKeyedChildren（有 key 的 diff 核心，5 步走 + LIS）

这是 Vue3 真正的 diff 核心算法，分 5 步：

### Step 1：从头部同步

```ts
// 旧: (a b) c d e
// 新: (a b) e c d
// 头部 a、b 相同，直接 patch，不用动
while (i <= e1 && i <= e2) {
  if (isSameVNodeType(n1, n2)) {
    patch(n1, n2, ...)
  } else {
    break
  }
  i++
}
```

### Step 2：从尾部同步

```ts
// 旧: a b c (d e)
// 新: a c b (d e)
// 尾部 d、e 相同，直接 patch，不用动
while (i <= e1 && i <= e2) {
  if (isSameVNodeType(n1, n2)) {
    patch(n1, n2, ...)
  } else {
    break
  }
  e1--
  e2--
}
```

### Step 3：旧的比完了，新的还有 → 纯新增

```ts
// 旧: (a b)
// 新: (a b) c d
// i = 2, e1 = 1, e2 = 3
if (i > e1) {
  if (i <= e2) {
    while (i <= e2) {
      patch(null, c2[i], ...)  // mount 新节点
      i++
    }
  }
}
```

### Step 4：新的比完了，旧的还有 → 纯删除

```ts
// 旧: (a b) c d
// 新: (a b)
// i = 2, e1 = 3, e2 = 1
else if (i > e2) {
  while (i <= e1) {
    unmount(c1[i])  // 卸载多余旧节点
    i++
  }
}
```

### Step 5：中间乱序区（最核心）

前 4 步处理完头尾和纯增删之后，剩下的就是中间乱序部分：

```
旧: a b [c d e    ] f g
新: a b [e d c h  ] f g
        ↑ 中间乱序区 ↑
```

**5.1 为新节点建 key → index 映射表**

```ts
const keyToNewIndexMap = new Map()
for (i = s2; i <= e2; i++) {
  keyToNewIndexMap.set(c2[i].key, i)
}
// { e→2, d→3, c→4, h→5 }
```

**5.2 遍历旧节点，通过 key 查找新位置**

```ts
const newIndexToOldIndexMap = new Array(toBePatched).fill(0)
// 初始值全为 0，表示新节点没有对应的旧节点

for (i = s1; i <= e1; i++) {
  const prevChild = c1[i]

  // 通过 key 找到旧节点在新列表中的位置
  newIndex = keyToNewIndexMap.get(prevChild.key)

  if (newIndex === undefined) {
    // 新列表中不存在 → 删除
    unmount(prevChild)
  } else {
    // 记录映射关系（+1 是因为 0 被用作"无对应旧节点"的标记）
    newIndexToOldIndexMap[newIndex - s2] = i + 1

    // 判断是否有节点移动（如果新位置不是递增的，说明有移动）
    if (newIndex >= maxNewIndexSoFar) {
      maxNewIndexSoFar = newIndex
    } else {
      moved = true
    }

    // patch 更新节点内容
    patch(prevChild, c2[newIndex], ...)
    patched++
  }
}
```

**5.3 移动和挂载（LIS 最长递增子序列）**

```ts
// 只有发生了移动才计算 LIS
const increasingNewIndexSequence = moved
  ? getSequence(newIndexToOldIndexMap)
  : EMPTY_ARR

// 从后往前遍历（方便用已 patch 的节点作为锚点）
j = increasingNewIndexSequence.length - 1
for (i = toBePatched - 1; i >= 0; i--) {
  if (newIndexToOldIndexMap[i] === 0) {
    // 旧列表中没有对应的 → 新节点，mount
    patch(null, nextChild, ...)
  } else if (moved) {
    if (j < 0 || i !== increasingNewIndexSequence[j]) {
      // 不在 LIS 中 → 需要移动
      move(nextChild, container, anchor, MoveType.REORDER)
    } else {
      // 在 LIS 中 → 不用动，位置已经是对的
      j--
    }
  }
}
```

**LIS 的意义**：找到中间乱序区中**最长的、相对顺序不变的节点子序列**，这些节点完全不需要移动 DOM，只移动其余的节点。这样可以用最少的 DOM 操作完成更新。

### 举个完整的例子

```
旧: a b [c d e    ] f g
新: a b [e d c h  ] f g

Step 1: 头部同步 → a, b 直接 patch
Step 2: 尾部同步 → f, g 直接 patch
Step 3/4: 不满足条件，跳过
Step 5: 中间乱序区 [c d e] → [e d c h]

5.1 keyToNewIndexMap = { e→2, d→3, c→4, h→5 }

5.2 遍历旧的 [c d e]：
    c → 新位置 4, newIndexToOldIndexMap[2] = 1
    d → 新位置 3, newIndexToOldIndexMap[1] = 2
    e → 新位置 2, newIndexToOldIndexMap[0] = 3
    结果: newIndexToOldIndexMap = [3, 2, 1, 0]
                                  e  d  c  h(新)
    moved = true（因为 3→2→1 不是递增的）

5.3 LIS([3, 2, 1, 0]) = [3]（长度为 1，只有 e 不用动）
    从后往前：
    h → oldIndex=0 → mount 新节点
    c → 不在 LIS → move
    d → 不在 LIS → move
    e → 在 LIS 中 → 不动
```

---

## patchBlockChildren（Block 优化的快速通道）

作为对比，当存在 `dynamicChildren` 时走的是 `patchBlockChildren`，逻辑极其简单：

```ts
const patchBlockChildren = (oldChildren, newChildren, ...) => {
  for (let i = 0; i < newChildren.length; i++) {
    patch(oldChildren[i], newChildren[i], container, ...)
  }
}
```

因为 Block 内的动态节点是**编译时确定的，数量和位置都不会变**，所以不需要任何 diff 算法，直接按索引一一对应 patch。假设模板有 100 个节点，其中 3 个是动态的，这个 for 循环只跑 3 次。

---

## 总结

| 方法 | 作用 | 复杂度 |
|------|------|--------|
| `patchBlockChildren` | Block 快速通道，编译时确定的动态节点直接逐个 patch | O(动态节点数) |
| `patchChildren` | 分流路由器，根据新旧 children 类型决定走哪条路 | O(1) 判断 |
| `patchUnkeyedChildren` | 无 key 简单 diff，按索引硬比较 | O(n) |
| `patchKeyedChildren` | 有 key 完整 diff，5步走 + LIS | O(n log n) |
