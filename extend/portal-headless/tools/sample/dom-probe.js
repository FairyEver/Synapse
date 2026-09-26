(() => {
  /**
   * 页内 DOM 探针（纯表达式，`bsk evaluate` 直接跑）。
   *
   * 回答「生成器给的这个参数，页面上到底是什么控件」。
   *
   * 关键实测事实（本次抽样验证得到，136 个 auto 页面里稳定成立）：
   * Portal 的列表页表单是 ant-design-vue 的 `<a-form>`，FormItem 生成的 input **id**
   * 就是 `form_item_<字段名>`。也就是说 **DOM 自己就告诉了你契约里的名字对不对**——
   * 不需要从源码推、也不需要猜。于是「契约里有但页面上没有控件」这种错
   * （`isArchived` 那一类）可以在浏览器里被直接判出来。
   *
   * 返回的是 JSON 字符串（bsk 的 --return-by-value 只回可序列化值）。
   */
  const ALL = document.querySelectorAll.bind(document)

  /** 控件分类：只判到「会不会让调用方传错值」这一层，不追求还原 antd 组件名。 */
  const classify = (el) => {
    const chain = []
    let node = el
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) chain.push(node)
    const has = (sel) => chain.some((n) => n.matches && n.matches(sel))

    if (has('.ant-picker-range')) return { control: 'range-picker' }
    if (has('.ant-picker')) {
      const picker = chain.find((n) => n.matches && n.matches('.ant-picker'))
      const cls = picker ? picker.className : ''
      return { control: 'picker', pickerClass: cls.replace(/\s+/g, ' ') }
    }
    if (has('.ant-select')) {
      const sel = chain.find((n) => n.matches && n.matches('.ant-select'))
      const cls = sel ? sel.className : ''
      return {
        control: 'select',
        multiple: /ant-select-multiple/.test(cls),
        // show-search 的下拉是空输入框 + type=search，调用方必须给关键字才能收敛候选
        showSearch: el.type === 'search',
        selectText: sel ? sel.innerText.replace(/\s+/g, ' ').trim().slice(0, 60) : null,
      }
    }
    if (has('.ant-input-number')) return { control: 'input-number' }
    if (has('.ant-cascader')) return { control: 'cascader' }
    if (has('.ant-tree-select')) return { control: 'tree-select' }
    if (has('.ant-switch')) return { control: 'switch' }
    if (has('.ant-checkbox-group')) return { control: 'checkbox-group' }
    if (has('.ant-radio-group')) return { control: 'radio-group' }
    if (has('.ant-input-affix-wrapper') || has('.ant-input')) return { control: 'text' }
    return { control: 'unknown', tag: el.tagName, cls: String(el.className).slice(0, 60) }
  }

  const items = []
  for (const el of ALL('[id^="form_item_"]')) {
    const name = el.id.slice('form_item_'.length)
    const formItem = el.closest('.ant-form-item')
    const labelEl = formItem && formItem.querySelector('.ant-form-item-label')
    items.push({
      name,
      label: labelEl ? labelEl.innerText.replace(/\s+/g, ' ').trim() : null,
      value: el.value ?? null,
      placeholder: el.placeholder ?? null,
      readOnly: el.readOnly === true,
      ...classify(el),
    })
  }

  /**
   * **没有 `form_item_*` id 的表单项**——这是本探针的已知盲区，必须显式报出来。
   *
   * 实测（2026-09-20，作业/成绩页）：antdv 未必把 id 注入到每个控件上。
   * `/dashboard/grade/grade/list` 的「学员人数」是两个 `a-input-number`，包在 `a-space` 里，
   * DOM 里**根本没有** `form_item_studentNumMin`——但源码里它 `v-model:value` 绑得明明白白。
   * 只看 id 会把它误判成"页面上没有这个控件"，而那是**假的**。
   * 所以这里把所有表单项都列出来、标出哪些没有 id，让"没找到控件"这个结论
   * 至少能被"页面上确实有一个我映射不到的表单项"这条证据反证。
   */
  const unmappedFormItems = [...ALL('.ant-form-item')].filter((fi) => {
    if (!fi.offsetParent) return false // 不可见的（折叠起来的）不算
    return !fi.querySelector('[id^="form_item_"]')
  }).map((fi) => {
    const labelEl = fi.querySelector('.ant-form-item-label')
    const control = fi.querySelector('.ant-select, .ant-picker, .ant-input-number, .ant-input, .ant-radio-group, .ant-checkbox-group, .ant-switch, .ant-cascader')
    return {
      label: labelEl ? labelEl.innerText.replace(/\s+/g, ' ').trim() : null,
      controlGuess: control ? String(control.className).split(' ').filter((c) => c.startsWith('ant-')).slice(0, 3).join(' ') : null,
      innerText: fi.innerText.replace(/\s+/g, ' ').trim().slice(0, 40),
    }
  })

  // 页面上的下拉不止表单里的（「20 条/页」也是），分开列，避免误当成参数
  const selects = [...ALL('.ant-select')].map((s) => ({
    inForm: !!s.closest('.ant-form-item'),
    id: s.querySelector('input') ? s.querySelector('input').id : null,
    text: s.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
  }))

  return JSON.stringify({
    url: location.href,
    menuPathCookie: (document.cookie.match(/hr-0\.0\.0-menuPath=([^;]*)/) || [])[1] || null,
    formItems: items,
    unmappedFormItems,
    selects,
    buttons: [...ALL('button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean),
  })
})()
