import { createSignal } from 'solid-js'
import './Resizer.css'

interface ResizerProps {
	onResize: (deltaX: number) => void
}

export default function Resizer(props: ResizerProps) {
	const [active, setActive] = createSignal(false)

	function onMouseDown(e: MouseEvent) {
		e.preventDefault()
		setActive(true)
		let lastX = e.clientX

		const onMouseMove = (e: MouseEvent) => {
			const delta = e.clientX - lastX
			lastX = e.clientX
			props.onResize(delta)
		}

		const onMouseUp = () => {
			setActive(false)
			document.removeEventListener('mousemove', onMouseMove)
			document.removeEventListener('mouseup', onMouseUp)
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
		}

		document.body.style.cursor = 'col-resize'
		document.body.style.userSelect = 'none'
		document.addEventListener('mousemove', onMouseMove)
		document.addEventListener('mouseup', onMouseUp)
	}

	return (
		<div
			class="resizer"
			classList={{ 'resizer--active': active() }}
			onMouseDown={onMouseDown}
		/>
	)
}
