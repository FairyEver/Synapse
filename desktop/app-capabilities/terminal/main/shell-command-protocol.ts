export type ShellReceiptEvent = { readonly type: "output"; readonly data: string }
  | { readonly type: "prompt"; readonly sequence: number; readonly exitCode: number; readonly quotedInsert?: boolean }
export const SHELL_QUOTED_INSERT = "\x1b[777~"
const PREFIX = "\x1b]777;SynapseShell;"

/** Private OSC frames are consumed before raw buffers, logs or renderer subscriptions. */
export function createShellReceiptDecoder(token: string, pid: () => number | undefined) {
  let pending = "", discarding = false, lastSequence = 0
  return { push(data: string): ShellReceiptEvent[] {
    pending += data
    const result: ShellReceiptEvent[] = []
    const emit = (text: string) => {
      if (!text) return
      const last = result[result.length - 1]
      if (last?.type === "output") result[result.length - 1] = { type: "output", data: last.data + text }
      else result.push({ type: "output", data: text })
    }
    while (pending) {
      if (discarding || pending.startsWith(PREFIX)) {
        const bel = pending.indexOf("\x07"), st = pending.indexOf("\x1b\\")
        const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st)
        if (end === -1) {
          if (pending.length > 1024 || discarding) { discarding = true; pending = pending.endsWith("\x1b") ? "\x1b" : "" }
          break
        }
        const payload = discarding ? "" : pending.slice(PREFIX.length, end)
        pending = pending.slice(end + (pending[end] === "\x07" ? 1 : 2))
        discarding = false
        const match = /^([a-f0-9]{32});([0-9]+);([0-9]+);([0-9]+)(?:;([01]))?$/.exec(payload)
        if (match && match[1] === token && Number(match[2]) === pid()) {
          const sequence = Number(match[3]), exitCode = Number(match[4])
          if (Number.isSafeInteger(sequence) && sequence > lastSequence && exitCode <= 255) {
            lastSequence = sequence; result.push({ type: "prompt", sequence, exitCode, ...(match[5] === "1" ? { quotedInsert: true } : {}) })
          }
        }
        continue
      }
      const start = pending.indexOf("\x1b")
      if (start === -1) { emit(pending); pending = ""; break }
      if (start > 0) { emit(pending.slice(0, start)); pending = pending.slice(start); continue }
      if (PREFIX.startsWith(pending)) break
      emit(pending[0]!); pending = pending.slice(1)
    }
    return result
  } }
}

/** Both manual and automatic terminals receive the same prompt hooks and startup files. */
export const ZSH_COMMAND_RECEIPT_HOOK = String.raw`
if [[ -n "${'${SYNAPSE_TERMINAL_SHELL_TOKEN:-}'}" && -o interactive ]]; then
  typeset -gi _synapse_quoted_insert=0
  if builtin bindkey -M emacs $'\e[777~' quoted-insert 2>/dev/null && builtin bindkey -M viins $'\e[777~' quoted-insert 2>/dev/null; then _synapse_quoted_insert=1; fi
  _synapse_shell_prompt() {
    local _synapse_exit=$?
    typeset -gi _synapse_prompt_sequence
    ((_synapse_prompt_sequence += 1))
    PROMPT="${'${PROMPT%"${_synapse_prompt_suffix-}"}'}"
    builtin printf -v _synapse_prompt_suffix '%%{\033]777;SynapseShell;%s;%s;%s;%s;%s\a%%}' "$SYNAPSE_TERMINAL_SHELL_TOKEN" "$$" "$_synapse_prompt_sequence" "$_synapse_exit" "$_synapse_quoted_insert"
    PROMPT+="$_synapse_prompt_suffix"
    return 0
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd _synapse_shell_prompt
fi
`

export const BASH_COMMAND_RECEIPT_HOOK = String.raw`
if [[ -n "${'${SYNAPSE_TERMINAL_SHELL_TOKEN:-}'}" && $- == *i* ]]; then
  _synapse_quoted_insert=0
  if builtin bind -m emacs-standard '"\e[777~": quoted-insert' 2>/dev/null && builtin bind -m vi-insert '"\e[777~": quoted-insert' 2>/dev/null; then _synapse_quoted_insert=1; fi
  _synapse_shell_capture() { _synapse_command_status=$?; return "$_synapse_command_status"; }
  _synapse_shell_prompt() {
    local _synapse_previous=$?
    _synapse_prompt_sequence=$(( ${'${_synapse_prompt_sequence:-0}'} + 1 ))
    PS1="${'${PS1%"${_synapse_prompt_suffix-}"}'}"
    builtin printf -v _synapse_prompt_suffix '\\[\033]777;SynapseShell;%s;%s;%s;%s;%s\a\\]' "$SYNAPSE_TERMINAL_SHELL_TOKEN" "$$" "$_synapse_prompt_sequence" "${'${_synapse_command_status:-0}'}" "$_synapse_quoted_insert"
    PS1+="$_synapse_prompt_suffix"
    return "$_synapse_previous"
  }
  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == 'declare -a '* ]]; then
    if [[ " ${'${PROMPT_COMMAND[*]}'} " != *' _synapse_shell_capture '* ]]; then
      PROMPT_COMMAND=(_synapse_shell_capture "${'${PROMPT_COMMAND[@]}'}" _synapse_shell_prompt)
    fi
  elif [[ "${'${PROMPT_COMMAND:-}'}" != *'_synapse_shell_capture'* ]]; then
    PROMPT_COMMAND="_synapse_shell_capture; ${'${PROMPT_COMMAND:+$PROMPT_COMMAND;}'} _synapse_shell_prompt"
  fi
fi
`
