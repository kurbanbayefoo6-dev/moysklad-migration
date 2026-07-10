import { productRepository } from '../repositories/productRepository.js'
import { BaseResolver, EntityNotFoundError } from './BaseResolver.js'

function getValue(source, field) {
	return source?.[field] || ''
}

function normalizeValue(value) {
	return String(value ?? '').trim()
}

function buildMissingProductMessage(source) {
	return [
		'Product not found',
		`name: ${getValue(source, 'name')}`,
		`code: ${getValue(source, 'code')}`,
		`article: ${getValue(source, 'article')}`,
		`externalCode: ${getValue(source, 'externalCode')}`,
	].join('\n')
}

function printMissingProduct(source, shipmentNumber) {
	return { source, shipmentNumber }
}

function formatLookupResult(product) {
	if (!product) {
		return 'NOT FOUND'
	}

	return [
		'FOUND',
		`id=${getValue(product, 'id')}`,
		`name=${getValue(product, 'name')}`,
		`code=${getValue(product, 'code')}`,
		`article=${getValue(product, 'article')}`,
		`externalCode=${getValue(product, 'externalCode')}`,
	].join(' ')
}

function productMatchesSource(product, source) {
	const externalCode = normalizeValue(source?.externalCode)
	if (
		externalCode &&
		normalizeValue(product?.externalCode) === externalCode
	) {
		return true
	}

	const code = normalizeValue(source?.code)
	if (code && normalizeValue(product?.code) === code) {
		return true
	}

	const article = normalizeValue(source?.article)
	if (article && normalizeValue(product?.article) === article) {
		return true
	}

	const name = normalizeValue(source?.name)
	return Boolean(name && normalizeValue(product?.name) === name)
}

function extractMeta(product) {
	if (!product?.meta?.href || !product?.meta?.type || !product?.meta?.mediaType) {
		return null
	}

	return {
		href: product.meta.href,
		type: product.meta.type,
		mediaType: product.meta.mediaType,
	}
}

export class ProductResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Product',
			repository: options.repository || productRepository,
			client: options.client || 'new',
			strategies: [
				{
					name: 'externalCode',
					field: 'externalCode',
					method: 'findByExternalCode',
				},
				{ name: 'code', field: 'code', method: 'findByCode' },
				{
					name: 'article',
					field: 'article',
					method: 'findByArticle',
				},
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
	}

	async inspectLookup(source, options) {
		const context = { ...options, client: options.client || this.client }
		const products = await this.getEntities(context)
		const existsInCache = products.some(product =>
			productMatchesSource(product, source),
		)
		const externalCodeResult = await this.repository.findByExternalCode(
			source?.externalCode,
			context,
		)
		const codeResult = await this.repository.findByCode(source?.code, context)
		const articleResult = await this.repository.findByArticle(
			source?.article,
			context,
		)
		const nameResult = await this.repository.findByName(source?.name, context)

		formatLookupResult(externalCodeResult)
		formatLookupResult(codeResult)
		formatLookupResult(articleResult)
		formatLookupResult(nameResult)

		return (
			externalCodeResult ||
			codeResult ||
			articleResult ||
			nameResult ||
			null
		)
	}

	async resolve(source, options = {}) {
		try {
			return await super.resolve(source, options)
		} catch (error) {
			if (error instanceof EntityNotFoundError) {
				const directlyFoundProduct = await this.inspectLookup(source, options)
				const meta = extractMeta(directlyFoundProduct)
				if (meta) {
					this.cacheMeta(source, meta)
					return { meta }
				}

				printMissingProduct(source, options.shipmentNumber)
				throw new Error(buildMissingProductMessage(source))
			}

			throw error
		}
	}
}

export const productResolver = new ProductResolver()

export default productResolver
