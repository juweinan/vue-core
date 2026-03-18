import {
  ConstantTypes,
  RootNode,
  NodeTypes,
  TemplateChildNode,
  SimpleExpressionNode,
  ElementTypes,
  PlainElementNode,
  ComponentNode,
  TemplateNode,
  VNodeCall,
  ParentNode,
  JSChildNode,
  CallExpression,
  createArrayExpression
} from '../ast'
import { TransformContext } from '../transform'
import { PatchFlags, isString, isSymbol, isArray } from '@vue/shared'
import { getVNodeBlockHelper, getVNodeHelper, isSlotOutlet } from '../utils'
import {
  OPEN_BLOCK,
  GUARD_REACTIVE_PROPS,
  NORMALIZE_CLASS,
  NORMALIZE_PROPS,
  NORMALIZE_STYLE
} from '../runtimeHelpers'

export function hoistStatic(root: RootNode, context: TransformContext) {
  walk(
    root,
    context,
    // 不幸的是，由于潜在的父节点失效属性，根节点默认是不可提升的。
    isSingleElementRoot(root, root.children[0])
  )
}

export function isSingleElementRoot(
  root: RootNode,
  child: TemplateChildNode
): child is PlainElementNode | ComponentNode | TemplateNode {
  const { children } = root
  // 是否只有一个子节点，并且子节点类型是元素节点，并且还不是 slot 标签
  return (
    children.length === 1 &&
    child.type === NodeTypes.ELEMENT &&
    !isSlotOutlet(child)
  )
}

/**
 * 
 * @param node 
 * @param context 
 * @param doNotHoistNode 不是需要提升的节点
 */
function walk(
  node: ParentNode,
  context: TransformContext,
  doNotHoistNode: boolean = false
) {
  // 获取当前节点的子节点
  const { children } = node
  // 子节点本来的数量
  const originalCount = children.length
  // 提升的子节点数量
  let hoistedCount = 0

  // 遍历子节点
  for (let i = 0; i < children.length; i++) {
    // 当前子节点
    const child = children[i]
    // 只有纯元素和文本调用才有资格提升
    // 如果子节点的类型是元素节点 && 标签类型也是元素类型标签
    if (
      child.type === NodeTypes.ELEMENT &&
      child.tagType === ElementTypes.ELEMENT
    ) {
      // 如果明确了是不需要提升的节点，那么类型是非恒定的
      // 否则是根据当前节点判断常量类型
      const constantType = doNotHoistNode
        ? ConstantTypes.NOT_CONSTANT
        : getConstantType(child, context)
      // 恒定的
      if (constantType > ConstantTypes.NOT_CONSTANT) {
        // 如果是可静态提升的，或者是可字符串化的
        if (constantType >= ConstantTypes.CAN_HOIST) {
          // 当前子节点 patchFlag 标记为 HOISTED
          ;(child.codegenNode as VNodeCall).patchFlag =
            PatchFlags.HOISTED + (__DEV__ ? ` /* HOISTED */` : ``)
          // 存储到 hoists 上
          child.codegenNode = context.hoist(child.codegenNode!)
          hoistedCount++
          continue
        }
      } else {
        // 节点可能包含了很多动态的子节点，但是他的属性可能是可以提升的
        const codegenNode = child.codegenNode!
        // VNODE_CALL 代表的是什么
        if (codegenNode.type === NodeTypes.VNODE_CALL) {
          // 获取解析的 patchFlag
          const flag = getPatchFlag(codegenNode)
          // 如果 flag 不存在
          // 或者是仅需进行非属性修补的元素
          // 或者是文本元素
          // 但是属性 props 的类型是可以提升或者字符串化的
          if (
            (!flag ||
              flag === PatchFlags.NEED_PATCH ||
              flag === PatchFlags.TEXT) &&
            getGeneratedPropsConstantType(child, context) >=
              ConstantTypes.CAN_HOIST
          ) {
            // 获取节点的 prop，标记为可以静态提升
            const props = getNodeProps(child)
            if (props) {
              codegenNode.props = context.hoist(props)
            }
          }
          // 动态提升（目的是可以直接动态比较属性）
          if (codegenNode.dynamicProps) {
            codegenNode.dynamicProps = context.hoist(codegenNode.dynamicProps)
          }
        }
      }
    } else if (
      child.type === NodeTypes.TEXT_CALL &&
      getConstantType(child.content, context) >= ConstantTypes.CAN_HOIST
    ) {
      // 如果是文本类型的，直接标记为静态节点
      child.codegenNode = context.hoist(child.codegenNode)
      hoistedCount++
    }

    // 进一步 walk
    // 元素节点，但是组件元素节点
    if (child.type === NodeTypes.ELEMENT) {
      const isComponent = child.tagType === ElementTypes.COMPONENT
      if (isComponent) {
        context.scopes.vSlot++
      }
      // 递归组件节点（处理组件的子节点，但是这里第三个参数默认是 false）
      // 表示 child 本身是可以被提升的节点
      walk(child, context)
      if (isComponent) {
        context.scopes.vSlot--
      }
    } else if (child.type === NodeTypes.FOR) {
      // 不要提升 v-for 中的单个子节点 因为他被当作一个 block
      walk(child, context, child.children.length === 1)
    } else if (child.type === NodeTypes.IF) {
      for (let i = 0; i < child.branches.length; i++) {
        // 不要提升 v-if 中的单个子节点 因为他被当作一个 block
        walk(
          child.branches[i],
          context,
          child.branches[i].children.length === 1
        )
      }
    }
  }

  if (hoistedCount && context.transformHoist) {
    context.transformHoist(children, context, node)
  }

  // 所有的子节点都被提升了——整个节点都可以提升。
  if (
    hoistedCount &&
    hoistedCount === originalCount &&
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.ELEMENT &&
    node.codegenNode &&
    node.codegenNode.type === NodeTypes.VNODE_CALL &&
    isArray(node.codegenNode.children)
  ) {
    node.codegenNode.children = context.hoist(
      createArrayExpression(node.codegenNode.children)
    )
  }
}

/**
 * 获取常量类型
 * @param node 
 * @param context 
 * @returns 
 */
export function getConstantType(
  node: TemplateChildNode | SimpleExpressionNode,
  context: TransformContext
): ConstantTypes {
  const { constantCache } = context
  switch (node.type) {
    // 是元素节点
    case NodeTypes.ELEMENT:
      // 但不是元素标签（SLOT、TEMPLATE、COMPONENT）
      if (node.tagType !== ElementTypes.ELEMENT) {
        // 这种节点肯定不是永恒不变的
        return ConstantTypes.NOT_CONSTANT
      }
      // 从永恒不变的缓存中读取当前节点
      const cached = constantCache.get(node)
      // 如果有，直接返回
      if (cached !== undefined) {
        return cached
      }
      const codegenNode = node.codegenNode!
      if (codegenNode.type !== NodeTypes.VNODE_CALL) {
        return ConstantTypes.NOT_CONSTANT
      }
      if (
        codegenNode.isBlock &&
        node.tag !== 'svg' &&
        node.tag !== 'foreignObject'
      ) {
        return ConstantTypes.NOT_CONSTANT
      }
      // 获取 patchFlag
      const flag = getPatchFlag(codegenNode)
      if (!flag) {
        // 默认是可格式化的字符串
        let returnType = ConstantTypes.CAN_STRINGIFY

        // 元素本身没有补丁标志。但是，我们仍然需要检查：

        // 1. 即使对于没有补丁标志的节点，它也可能包含引用作用域变量的不可提升表达式，
        // 例如编译器注入的键或缓存的事件处理程序。
        // 因此，我们需要始终检查 codegenNode 的 props 以确保。
        const generatedPropsType = getGeneratedPropsConstantType(node, context)
        if (generatedPropsType === ConstantTypes.NOT_CONSTANT) {
          constantCache.set(node, ConstantTypes.NOT_CONSTANT)
          return ConstantTypes.NOT_CONSTANT
        }
        if (generatedPropsType < returnType) {
          returnType = generatedPropsType
        }

        // 2. its children.
        for (let i = 0; i < node.children.length; i++) {
          const childType = getConstantType(node.children[i], context)
          if (childType === ConstantTypes.NOT_CONSTANT) {
            constantCache.set(node, ConstantTypes.NOT_CONSTANT)
            return ConstantTypes.NOT_CONSTANT
          }
          if (childType < returnType) {
            returnType = childType
          }
        }

        // 3. if the type is not already CAN_SKIP_PATCH which is the lowest non-0
        // type, check if any of the props can cause the type to be lowered
        // we can skip can_patch because it's guaranteed by the absence of a
        // patchFlag.
        if (returnType > ConstantTypes.CAN_SKIP_PATCH) {
          for (let i = 0; i < node.props.length; i++) {
            const p = node.props[i]
            if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && p.exp) {
              const expType = getConstantType(p.exp, context)
              if (expType === ConstantTypes.NOT_CONSTANT) {
                constantCache.set(node, ConstantTypes.NOT_CONSTANT)
                return ConstantTypes.NOT_CONSTANT
              }
              if (expType < returnType) {
                returnType = expType
              }
            }
          }
        }

        // only svg/foreignObject could be block here, however if they are
        // static then they don't need to be blocks since there will be no
        // nested updates.
        if (codegenNode.isBlock) {
          // except set custom directives.
          for (let i = 0; i < node.props.length; i++) {
            const p = node.props[i]
            if (p.type === NodeTypes.DIRECTIVE) {
              constantCache.set(node, ConstantTypes.NOT_CONSTANT)
              return ConstantTypes.NOT_CONSTANT
            }
          }

          context.removeHelper(OPEN_BLOCK)
          context.removeHelper(
            getVNodeBlockHelper(context.inSSR, codegenNode.isComponent)
          )
          codegenNode.isBlock = false
          context.helper(getVNodeHelper(context.inSSR, codegenNode.isComponent))
        }

        constantCache.set(node, returnType)
        return returnType
      } else {
        constantCache.set(node, ConstantTypes.NOT_CONSTANT)
        return ConstantTypes.NOT_CONSTANT
      }
    // 文本注释节点：标记为可字符串化
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
      return ConstantTypes.CAN_STRINGIFY
    // if 条件、for 循环，都是非静态的
    case NodeTypes.IF:
    case NodeTypes.FOR:
    case NodeTypes.IF_BRANCH:
      return ConstantTypes.NOT_CONSTANT
    case NodeTypes.INTERPOLATION:
    case NodeTypes.TEXT_CALL:
      return getConstantType(node.content, context)
    case NodeTypes.SIMPLE_EXPRESSION:
      return node.constType
    case NodeTypes.COMPOUND_EXPRESSION:
      let returnType = ConstantTypes.CAN_STRINGIFY
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (isString(child) || isSymbol(child)) {
          continue
        }
        const childType = getConstantType(child, context)
        if (childType === ConstantTypes.NOT_CONSTANT) {
          return ConstantTypes.NOT_CONSTANT
        } else if (childType < returnType) {
          returnType = childType
        }
      }
      return returnType
    default:
      if (__DEV__) {
        const exhaustiveCheck: never = node
        exhaustiveCheck
      }
      // 默认就是非静态的
      return ConstantTypes.NOT_CONSTANT
  }
}

const allowHoistedHelperSet = new Set([
  NORMALIZE_CLASS,
  NORMALIZE_STYLE,
  NORMALIZE_PROPS,
  GUARD_REACTIVE_PROPS
])

function getConstantTypeOfHelperCall(
  value: CallExpression,
  context: TransformContext
): ConstantTypes {
  if (
    value.type === NodeTypes.JS_CALL_EXPRESSION &&
    !isString(value.callee) &&
    allowHoistedHelperSet.has(value.callee)
  ) {
    const arg = value.arguments[0] as JSChildNode
    if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
      return getConstantType(arg, context)
    } else if (arg.type === NodeTypes.JS_CALL_EXPRESSION) {
      // in the case of nested helper call, e.g. `normalizeProps(guardReactiveProps(exp))`
      return getConstantTypeOfHelperCall(arg, context)
    }
  }
  return ConstantTypes.NOT_CONSTANT
}

function getGeneratedPropsConstantType(
  node: PlainElementNode,
  context: TransformContext
): ConstantTypes {
  let returnType = ConstantTypes.CAN_STRINGIFY
  const props = getNodeProps(node)
  if (props && props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
    const { properties } = props
    for (let i = 0; i < properties.length; i++) {
      const { key, value } = properties[i]
      const keyType = getConstantType(key, context)
      if (keyType === ConstantTypes.NOT_CONSTANT) {
        return keyType
      }
      if (keyType < returnType) {
        returnType = keyType
      }
      let valueType: ConstantTypes
      if (value.type === NodeTypes.SIMPLE_EXPRESSION) {
        valueType = getConstantType(value, context)
      } else if (value.type === NodeTypes.JS_CALL_EXPRESSION) {
        // some helper calls can be hoisted,
        // such as the `normalizeProps` generated by the compiler for pre-normalize class,
        // in this case we need to respect the ConstantType of the helper's arguments
        valueType = getConstantTypeOfHelperCall(value, context)
      } else {
        valueType = ConstantTypes.NOT_CONSTANT
      }
      if (valueType === ConstantTypes.NOT_CONSTANT) {
        return valueType
      }
      if (valueType < returnType) {
        returnType = valueType
      }
    }
  }
  return returnType
}

function getNodeProps(node: PlainElementNode) {
  const codegenNode = node.codegenNode!
  if (codegenNode.type === NodeTypes.VNODE_CALL) {
    return codegenNode.props
  }
}

/**
 * 获取当前节点的 patchFlag（十进制）
 * @param node 
 * @returns 
 */
function getPatchFlag(node: VNodeCall): number | undefined {
  const flag = node.patchFlag
  return flag ? parseInt(flag, 10) : undefined
}
