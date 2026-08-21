import { useEffect, useMemo } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'

interface Props {
  value: string
  noteImages: Record<string, string>
  placeholder: string
  readOnly?: boolean
  onChange?: (markdown: string) => void
  onStoreImage?: (id: string, dataUrl: string) => void
}

export default function MarkdownWysiwygEditor({ value, noteImages, placeholder, readOnly = false, onChange, onStoreImage }: Props) {
  const hydrated = useMemo(() => value.replace(/note-image:([\w-]+)/g, (_, id) => noteImages[id] ?? ''), [noteImages, value])
  const editor = useEditor({
    extensions: [StarterKit, Image, Markdown],
    content: hydrated,
    contentType: 'markdown',
    editable: !readOnly,
    editorProps: {
      attributes: { class: 'wg-markdown-wysiwyg', 'data-placeholder': placeholder },
      handlePaste(view, event) {
        if (readOnly) return false
        const image = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile()
        if (!image) return false
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result !== 'string') return
          const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          onStoreImage?.(id, reader.result)
          view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image.create({ src: reader.result, alt: '粘贴图片' })))
        }
        reader.readAsDataURL(image)
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      if (readOnly || !onChange) return
      let markdown = current.getMarkdown()
      for (const [id, dataUrl] of Object.entries(noteImages)) markdown = markdown.replaceAll(dataUrl, `note-image:${id}`)
      onChange(markdown)
    },
  })

  useEffect(() => {
    if (!editor || editor.getMarkdown() === hydrated) return
    editor.commands.setContent(hydrated, { contentType: 'markdown', emitUpdate: false })
  }, [editor, hydrated])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  return <EditorContent editor={editor} />
}
