import ArrowDown from 'lucide-solid/icons/arrow-down'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import Bookmark from 'lucide-solid/icons/bookmark'
import Check from 'lucide-solid/icons/check'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import CircleAlert from 'lucide-solid/icons/circle-alert'
import Columns3 from 'lucide-solid/icons/columns-3'
import Command from 'lucide-solid/icons/command'
import Copy from 'lucide-solid/icons/copy'
import Database from 'lucide-solid/icons/database'
import Download from 'lucide-solid/icons/download'
import Eye from 'lucide-solid/icons/eye'
import EyeOff from 'lucide-solid/icons/eye-off'
import Filter from 'lucide-solid/icons/funnel'
import GitCompareArrows from 'lucide-solid/icons/git-compare-arrows'
import Grid3x3 from 'lucide-solid/icons/grid-3x3'
import History from 'lucide-solid/icons/history'
import Info from 'lucide-solid/icons/info'
import Key from 'lucide-solid/icons/key'
import Layers from 'lucide-solid/icons/layers'
import Link from 'lucide-solid/icons/link'
import PanelLeft from 'lucide-solid/icons/panel-left'
import Pencil from 'lucide-solid/icons/pencil'
import Pin from 'lucide-solid/icons/pin'
import Play from 'lucide-solid/icons/play'
import Plus from 'lucide-solid/icons/plus'
import RefreshCw from 'lucide-solid/icons/refresh-cw'
import Save from 'lucide-solid/icons/save'
import Search from 'lucide-solid/icons/search'
import Settings from 'lucide-solid/icons/settings'
import Sparkles from 'lucide-solid/icons/sparkles'
import Square from 'lucide-solid/icons/square'
import SquareTerminal from 'lucide-solid/icons/square-terminal'
import Table from 'lucide-solid/icons/table'
import Trash2 from 'lucide-solid/icons/trash-2'
import TriangleAlert from 'lucide-solid/icons/triangle-alert'
import Upload from 'lucide-solid/icons/upload'
import Workflow from 'lucide-solid/icons/workflow'
import X from 'lucide-solid/icons/x'
import { type JSX, Show } from 'solid-js'
import type { JSX as SolidJSX } from 'solid-js/jsx-runtime'
import { Dynamic } from 'solid-js/web'

type LucideProps = Partial<SolidJSX.SvgSVGAttributes<SVGSVGElement>> & {
	size?: string | number
	color?: string
	strokeWidth?: string | number
	class?: string
}

export type IconName =
	| 'database'
	| 'table'
	| 'view'
	| 'schema'
	| 'grid'
	| 'sql-console'
	| 'play'
	| 'stop'
	| 'refresh'
	| 'plus'
	| 'close'
	| 'settings'
	| 'filter'
	| 'columns'
	| 'export'
	| 'import'
	| 'search'
	| 'copy'
	| 'edit'
	| 'delete'
	| 'arrow-left'
	| 'arrow-right'
	| 'chevron-left'
	| 'chevron-right'
	| 'chevron-down'
	| 'sort-asc'
	| 'sort-desc'
	| 'key'
	| 'link'
	| 'history'
	| 'save'
	| 'sidebar'
	| 'command'
	| 'pin'
	| 'eye'
	| 'eye-off'
	| 'check'
	| 'warning'
	| 'error'
	| 'info'
	| 'compare'
	| 'bookmark'
	| 'sparkles'
	| 'er-diagram'
	| 'spinner'

interface IconProps {
	name: IconName
	size?: number
	class?: string
	style?: JSX.CSSProperties
	title?: string
}

type LucideComponent = (props: LucideProps) => JSX.Element

const ICON_MAP: Record<Exclude<IconName, 'spinner'>, LucideComponent> = {
	database: Database,
	table: Table,
	view: Eye,
	schema: Layers,
	grid: Grid3x3,
	'sql-console': SquareTerminal,
	play: Play,
	stop: Square,
	refresh: RefreshCw,
	plus: Plus,
	close: X,
	settings: Settings,
	filter: Filter,
	columns: Columns3,
	export: Download,
	import: Upload,
	search: Search,
	copy: Copy,
	edit: Pencil,
	delete: Trash2,
	'arrow-left': ChevronLeft,
	'arrow-right': ChevronRight,
	'chevron-left': ChevronLeft,
	'chevron-right': ChevronRight,
	'chevron-down': ChevronDown,
	'sort-asc': ArrowUp,
	'sort-desc': ArrowDown,
	key: Key,
	link: Link,
	history: History,
	save: Save,
	sidebar: PanelLeft,
	command: Command,
	pin: Pin,
	eye: Eye,
	'eye-off': EyeOff,
	check: Check,
	warning: TriangleAlert,
	error: CircleAlert,
	info: Info,
	compare: GitCompareArrows,
	bookmark: Bookmark,
	sparkles: Sparkles,
	'er-diagram': Workflow,
}

export default function Icon(props: IconProps) {
	const size = () => props.size ?? 16

	return (
		<Show
			when={props.name !== 'spinner'}
			fallback={
				<span
					class={`spinner${props.class ? ` ${props.class}` : ''}`}
					style={{
						width: `${size()}px`,
						height: `${size()}px`,
						...(props.style ?? {}),
					}}
					title={props.title}
				/>
			}
		>
			<Dynamic
				component={ICON_MAP[props.name as Exclude<IconName, 'spinner'>]}
				size={size()}
				class={props.class}
				style={props.style}
				aria-hidden={!props.title}
				role={props.title ? 'img' : undefined}
			/>
		</Show>
	)
}
