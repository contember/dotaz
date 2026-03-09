import type { ExportOptions, ExportResult } from '@dotaz/shared/types/export'
import type { ImportPreviewRequest, ImportPreviewResult } from '@dotaz/shared/types/import'
import type { OpenDialogParams, SaveDialogParams } from '@dotaz/shared/types/rpc'
import { BackendAdapter, type BackendAdapterOptions, type EmitMessage } from '@dotaz/backend-shared/rpc/backend-adapter'
import { exportToStream, type ExportWriter } from '@dotaz/backend-shared/services/export-service'
import { importPreviewFromStream } from '@dotaz/backend-shared/services/import-service'
import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import type { QueryExecutor } from '@dotaz/backend-shared/services/query-executor'
import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import type * as vscode from 'vscode'

export interface VscodeBackendAdapterOptions extends BackendAdapterOptions {
	vscodeWindow?: typeof vscode.window
}

export class VscodeBackendAdapter extends BackendAdapter {
	private vscodeWindow?: typeof vscode.window

	constructor(
		cm: ConnectionManager,
		queryExecutor: QueryExecutor,
		appDb: any,
		opts?: VscodeBackendAdapterOptions,
	) {
		super(cm, queryExecutor, appDb, opts)
		this.vscodeWindow = opts?.vscodeWindow
	}

	protected override resolveImportStream(filePath?: string, fileContent?: string): ReadableStream<Uint8Array> {
		if (filePath) {
			const nodeStream = createReadStream(filePath)
			return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
		}
		if (fileContent !== undefined) {
			return new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(fileContent))
					controller.close()
				},
			})
		}
		throw new Error('Import requires either filePath or fileContent')
	}

	protected override resolveImportPreviewStream(filePath?: string, fileContent?: string): ReadableStream<Uint8Array> {
		if (filePath) {
			const PREVIEW_BYTES = 64 * 1024
			const nodeStream = createReadStream(filePath, { end: PREVIEW_BYTES - 1 })
			return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
		}
		if (fileContent !== undefined) {
			return new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(fileContent))
					controller.close()
				},
			})
		}
		throw new Error('Import preview requires either filePath or fileContent')
	}

	override async importPreview(req: ImportPreviewRequest): Promise<ImportPreviewResult> {
		const stream = this.resolveImportPreviewStream(req.filePath, req.fileContent)
		const result = await importPreviewFromStream(stream, {
			format: req.format,
			delimiter: req.delimiter,
			hasHeader: req.hasHeader,
			limit: req.limit,
		})
		if (req.filePath) {
			try {
				const stat = statSync(req.filePath)
				result.fileSizeBytes = stat.size
			} catch { /* ignore */ }
		}
		return result
	}

	override async exportData(opts: ExportOptions): Promise<ExportResult> {
		const driver = this.getDriver(opts.connectionId, opts.database)
		if (!opts.filePath) throw new Error('Export requires a file path')

		const emitMessage = (this as any).emitMessage as EmitMessage | undefined
		const onProgress = emitMessage
			? (rowCount: number) => emitMessage('export.progress', { rowCount })
			: undefined

		const fileStream = createWriteStream(opts.filePath)
		const writer: ExportWriter = {
			write(chunk) {
				if (typeof chunk === 'string') {
					fileStream.write(chunk)
				} else {
					fileStream.write(chunk)
				}
			},
			async end() {
				return new Promise((resolve, reject) => {
					fileStream.end(() => resolve())
					fileStream.on('error', reject)
				})
			},
		}

		try {
			const result = await exportToStream(
				driver,
				{
					schema: opts.schema,
					table: opts.table,
					format: opts.format,
					columns: opts.columns,
					includeHeaders: opts.includeHeaders,
					delimiter: opts.delimiter,
					encoding: opts.encoding,
					utf8Bom: opts.utf8Bom,
					batchSize: opts.batchSize,
					filters: opts.filters,
					sort: opts.sort,
					limit: opts.limit,
					autoJoins: opts.autoJoins,
				},
				writer,
				undefined,
				onProgress,
			)

			let sizeBytes = 0
			try {
				sizeBytes = statSync(opts.filePath).size
			} catch { /* ignore */ }

			return { ...result, sizeBytes, filePath: opts.filePath }
		} catch (err) {
			fileStream.end()
			try {
				const { unlinkSync } = await import('node:fs')
				unlinkSync(opts.filePath)
			} catch { /* best-effort cleanup */ }
			throw err
		}
	}

	override async showOpenDialog(params: OpenDialogParams): Promise<{ paths: string[]; cancelled: boolean }> {
		if (!this.vscodeWindow) {
			return { paths: [], cancelled: true }
		}
		const filters: Record<string, string[]> = {}
		if (params.filters) {
			for (const f of params.filters) {
				filters[f.name ?? 'Files'] = f.extensions
			}
		}
		const uris = await this.vscodeWindow.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: params.multiple ?? false,
			filters: Object.keys(filters).length > 0 ? filters : undefined,
		})
		if (!uris || uris.length === 0) {
			return { paths: [], cancelled: true }
		}
		return { paths: uris.map((u: vscode.Uri) => u.fsPath), cancelled: false }
	}

	override async showSaveDialog(params: SaveDialogParams): Promise<{ path: string | null; cancelled: boolean }> {
		if (!this.vscodeWindow) {
			return { path: null, cancelled: true }
		}
		const uri = await this.vscodeWindow.showSaveDialog({
			defaultUri: params.defaultName ? { fsPath: params.defaultName } as any : undefined,
		})
		if (!uri) {
			return { path: null, cancelled: true }
		}
		return { path: uri.fsPath, cancelled: false }
	}
}
