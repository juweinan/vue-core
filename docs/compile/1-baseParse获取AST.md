编译的入口方法是在 baseCompile 方法中。这个方法主要是做了三件事儿：

1. 调用 baseParse 方法，将 template 模版转换成 AST 树。
2. 调用 transform 方法，对 AST 树进行转换（直接改变了 AST 本身）
3. 调用 generate 方法，将 AST 树转换成 JavaScript 代码。

本节先看一下 baseParse 方法。

```ts
export function baseParse(
  content: string,
  options: ParserOptions = {}
): RootNode {
  const context = createParserContext(content, options)
  const start = getCursor(context)
  return createRoot(
    parseChildren(context, TextModes.DATA, []),
    getSelection(context, start)
  )
}
```

关于 createParserContext 方法，其实就是创建一个编译 template 的上下文对象。
这个对象里包含了原始的 template 字符串，剩余需要编译的 template 判断，source，当前编译所在的位置（三个参数游标），下面的那个 getCursor 就是获取代表游标的三个属性。

重点方法是在 createRoot 和 parseChildren 方法中。

先看 parseChildren。这个方法接收三个参数

- context：编译 template 的上下文对象
- mode：编译模式
- ancestors：当前节点的父节点栈（这个参数存在的意义就是能让嵌套的 html 元素能知道自己的父节点是什么）

```ts
const parent = last(ancestors)
const ns = parent ? parent.ns : Namespaces.HTML
const nodes: TemplateChildNode[] = []
```

默认情况下，从根节点开始解析，所以 ancestors 是空数组，否则的话，当前节点的负节点就是 ancestors 中的最后一个
nodes 其实最终存放的就是当前的子节点

```ts
while (!isEnd(context, mode, ancestors)) {
  const s = context.source
  let node: TemplateChildNode | TemplateChildNode[] | undefined = undefined

  if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
    if (!context.inVPre && startsWith(s, context.options.delimiters[0])) {
      node = parseInterpolation(context, mode)
    } else if (mode === TextModes.DATA && s[0] === '<') {
      if (s.length === 1) {
        emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 1)
      } else if (s[1] === '!') {
        if (startsWith(s, '<!--')) {
          node = parseComment(context) // 解析注释
        } else if (startsWith(s, '<!DOCTYPE')) {
          node = parseBogusComment(context)
        } else if (startsWith(s, '<![CDATA[')) {
          if (ns !== Namespaces.HTML) {
            node = parseCDATA(context, ancestors)
          } else {
            emitError(context, ErrorCodes.CDATA_IN_HTML_CONTENT)
            node = parseBogusComment(context)
          }
        } else {
          emitError(context, ErrorCodes.INCORRECTLY_OPENED_COMMENT)
          node = parseBogusComment(context)
        }
      } else if (s[1] === '/') {
        if (s.length === 2) {
          emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 2)
        } else if (s[2] === '>') {
          emitError(context, ErrorCodes.MISSING_END_TAG_NAME, 2)
          advanceBy(context, 3)
          continue
        } else if (/[a-z]/i.test(s[2])) {
          // 为什么结束标签，要报错，然后还继续匹配结束标签的 tag
          emitError(context, ErrorCodes.X_INVALID_END_TAG)
          parseTag(context, TagType.End, parent)
          continue
        } else {
          emitError(context, ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME, 2)
          node = parseBogusComment(context)
        }
      } else if (/[a-z]/i.test(s[1])) {
        node = parseElement(context, ancestors)
      } else if (s[1] === '?') {
        emitError(
          context,
          ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
          1
        )
        node = parseBogusComment(context)
      } else {
        emitError(context, ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME, 1)
      }
    }
  }
  if (!node) {
    node = parseText(context, mode)
  }

  if (isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      pushNode(nodes, node[i])
    }
  } else {
    pushNode(nodes, node)
  }
}
```

首先，判断是不是结束标签，如果不是结束标签，那么就一直循环，在这个循环里面（感觉这个 isEnd 并不是判断是不是结束标签，更像是判断是不是当前节点已经完整的解析完了）

先判断模式是不是 TextModes.DATA 或者 TextModes.RCDATA（这里需要你解释一下 TextModes 中这些数据的含义是什么？）

export const enum TextModes {
// | Elements | Entities | End sign | Inside of
DATA, // | ✔ | ✔ | End tags of ancestors |
RCDATA, // | ✘ | ✔ | End tag of the parent | <textarea>
RAWTEXT, // | ✘ | ✘ | End tag of the parent | <style>,<script>
CDATA,
ATTRIBUTE_VALUE
}

- 在这个模式下，如果匹配到了 {{ }} 这种格式，获取到解析出来的 node
- 如果匹配到 < 开头，那么就各种错误情况判断
  - 如果 source 的长度为 1，说明就剩下 < 报错
  - <! 情况，又分为是不是 `<!--` 注释，是不是 <!DOCTYPE 等等
  - </ 结束标签，是不是仅有 </，但是在 else if (/[a-z]/i.test(s[2])) 条件中，为什么既要 emitError 又要 parseTag（因为这里表示匹配到了结束标签，那么就可以匹配结束标签的 tag 了，怎么还要报错呢）
  - 如果是 < 开头，后面是 a-z 的字母，那表示这是一个标签的开始，然后执行 parseElement 方法。

所以，说了一大堆，需要重点关注的只有一个 parseElement

先继续向下看，如果在经历这么一大堆判断之后， node 还是不存在，那么表示这是个文本节点，然后 parseText

将得到的 所有 node 都添加到 nodes 中，然后去除空的节点并返回，这个时候，返回的 nodes 就是 parseChildren 的返回值

而这个返回值又被 createRoot 作为参数一使用，createRoot 是创建根 AST，这个 parseChildren 返回值就作为根的 children 使用了。

至此，根 ast 创建完成，他的孩子节点也通过 parseChildren 处理完成，只不过在这里我们还有一个 parseElement 还没有看。下面看一下这个方法的实现

```ts
const parent = last(ancestors)
const element = parseTag(context, TagType.Start, parent)
```

先获取最后一个祖先节点，然后开始解析 element，调用 parseTag 解析开始标签

- 先匹配到开始标签的 tag 名称，移动游标
- 处理开始标签上的属性，在解析属性时，如果存在多个重名的，直接提示错误
- 返回解析结果，type 固定是 ELEMENT，tagType 可能是多种类型，比如 ELEMENT、SLOT、TEMPLATE、COMPONENT

```ts
if (element.isSelfClosing || context.options.isVoidTag(element.tag)) {
  if (isPreBoundary) {
    context.inPre = false
  }
  if (isVPreBoundary) {
    context.inVPre = false
  }
  return element
}

ancestors.push(element)
const mode = context.options.getTextMode(element, parent)
const children = parseChildren(context, mode, ancestors)
ancestors.pop()
```

此时已经匹配完了开始标签，然后判断是否是自闭和的标签，如果是，直接返回当前开始标签返回的 element 就好了（这种情况下，当前 children 中的这一个 element 就解析完成了，然后开始下一个子节点解析。

如果不是自闭和标签，将当前 element 添加到祖先节点中，开始解析子节点（因为正常情况下一个非自闭和标签的内容肯定是存在子节点的，即使是空的子节点）调用 parseChildren，这时候有开始处理当前节点的子节点，就相当于上面处理跟节点的子节点一样。最后返回的 children 节点就是当前的子节点
然后将祖先节点的最后一个弹出，这样能保证当前节点这条线已经结束了。

上述可知，在生成 AST 的时候，是深度遍历优先的。

然后将 children 添加到 element 上。

这时候，开始标签解析完了，子节点解析完了，那后面的肯定就是对应的结束标签了。所以开始解析 EndTag，如果不是结束标签，就报错。最后返回 element。

至此 baseParse 结束， AST 创建完成

不过在这里，指令跟其他属性没有任何区别，都是放在 props 属性中
{{}} 表达式也跟普通的描述文本一样，都是作为渲染文字躺在 AST 中。

真正辨识他们身份和作用的，其实在 transform 中。
