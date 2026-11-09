// `==highlight==`: the mark syntax every CommentMarkdown surface parses and renders as `<mark>`.

import type { Data, Node, PhrasingContent } from 'mdast'
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { Code, Event, State, Token, TokenizeContext, Tokenizer } from 'micromark-util-types'
import { classifyCharacter } from 'micromark-util-classify-character'
import { resolveAll } from 'micromark-util-resolve-all'
import { constants } from 'micromark-util-symbol'
import type { Processor } from 'unified'

declare module 'micromark-util-types' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Declaration merging registers parser tokens.
  interface TokenTypeMap {
    chatHighlight: 'chatHighlight'
    chatHighlightText: 'chatHighlightText'
    chatHighlightSequence: 'chatHighlightSequence'
    chatHighlightSequenceTemporary: 'chatHighlightSequenceTemporary'
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Declaration merging extends upstream tokens.
  interface Token {
    chatHighlightSequenceTemporary?: { open: boolean; close: boolean }
  }
}

declare module 'mdast' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Declaration merging registers the parser node.
  interface RootContentMap {
    chatHighlight: ChatHighlight
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Declaration merging registers the parser node.
  interface PhrasingContentMap {
    chatHighlight: ChatHighlight
  }
}

export type ChatHighlight = Node & {
  type: 'chatHighlight'
  data?: Data & { hName: 'mark' }
  children: PhrasingContent[]
}

const equal: Code = 61

const tokenizeHighlight: Tokenizer = function (effects, ok, nok) {
  const previous = this.previous
  const events = this.events
  let size = 0
  return start

  function start(code: Code): State | undefined {
    // A `=` of a refused run reaches here again after the rewind; never a fresh opener.
    if (previous === equal && events.at(-1)?.[1].type !== 'characterEscape') {
      return nok(code)
    }
    effects.enter('chatHighlightSequenceTemporary')
    return more(code)
  }

  function more(code: Code): State | undefined {
    const before = classifyCharacter(previous)
    if (code === equal) {
      // Exactly two: a third marker refuses, so `===` never highlights.
      if (size > 1) {
        return nok(code)
      }
      effects.consume(code)
      size++
      return more
    }
    if (size !== 2) {
      return nok(code)
    }
    const token = effects.exit('chatHighlightSequenceTemporary')
    const after = classifyCharacter(code)
    token.chatHighlightSequenceTemporary = {
      open: !after || (after === constants.attentionSideAfter && Boolean(before)),
      close: !before || (before === constants.attentionSideAfter && Boolean(after))
    }
    return ok(code)
  }
}

/** Pairs the temporary runs into `chatHighlight` groups; leftovers turn back into text. */
function resolveAllHighlight(events: Event[], context: TokenizeContext): Event[] {
  let index = -1

  while (++index < events.length) {
    // A run that can close pairs with the nearest earlier run that can open.
    if (
      events[index][0] === 'enter' &&
      events[index][1].type === 'chatHighlightSequenceTemporary' &&
      events[index][1].chatHighlightSequenceTemporary?.close
    ) {
      const close = index
      let open = close

      while (open--) {
        if (
          events[open][0] === 'exit' &&
          events[open][1].type === 'chatHighlightSequenceTemporary' &&
          events[open][1].chatHighlightSequenceTemporary?.open
        ) {
          events[close][1].type = 'chatHighlightSequence'
          events[open][1].type = 'chatHighlightSequence'

          const group: Token = {
            type: 'chatHighlight',
            start: { ...events[open][1].start },
            end: { ...events[close][1].end }
          }
          const text: Token = {
            type: 'chatHighlightText',
            start: { ...events[open][1].end },
            end: { ...events[close][1].start }
          }

          const nextEvents: Event[] = [
            ['enter', group, context],
            ['enter', events[open][1], context],
            ['exit', events[open][1], context],
            ['enter', text, context]
          ]

          const insideSpan = context.parser.constructs.insideSpan?.null
          if (insideSpan) {
            nextEvents.push(...resolveAll(insideSpan, events.slice(open + 1, close), context))
          }

          nextEvents.push(
            ['exit', text, context],
            ['enter', events[close][1], context],
            ['exit', events[close][1], context],
            ['exit', group, context]
          )

          events.splice(open - 1, close - open + 3, ...nextEvents)
          index = open + nextEvents.length - 2
          break
        }
      }
    }
  }

  index = -1
  while (++index < events.length) {
    if (events[index][1].type === 'chatHighlightSequenceTemporary') {
      events[index][1].type = 'data'
    }
  }

  return events
}

const chatHighlightConstruct = {
  name: 'chatHighlight',
  tokenize: tokenizeHighlight,
  resolveAll: resolveAllHighlight
}

export const chatHighlightMicromark = {
  text: { [equal]: chatHighlightConstruct },
  insideSpan: { null: [chatHighlightConstruct] },
  attentionMarkers: { null: [equal] }
}

export const chatHighlightFromMarkdown: FromMarkdownExtension = {
  enter: {
    chatHighlight(token) {
      this.enter({ type: 'chatHighlight', data: { hName: 'mark' }, children: [] }, token)
    }
  },
  exit: {
    chatHighlight(token) {
      this.exit(token)
    }
  }
}

export function remarkChatHighlight(this: Processor): void {
  const data = this.data()
  const micromarkExtensions = data.micromarkExtensions ?? (data.micromarkExtensions = [])
  micromarkExtensions.push(chatHighlightMicromark)
  const fromMarkdownExtensions = data.fromMarkdownExtensions ?? (data.fromMarkdownExtensions = [])
  fromMarkdownExtensions.push(chatHighlightFromMarkdown)
}
