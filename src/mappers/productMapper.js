import { countryResolver } from '../resolvers/CountryResolver.js'
import { currencyResolver } from '../resolvers/CurrencyResolver.js'
import { priceTypeResolver } from '../resolvers/PriceTypeResolver.js'
import { productFolderResolver } from '../resolvers/ProductFolderResolver.js'
import { taxResolver } from '../resolvers/TaxResolver.js'
import { uomResolver } from '../resolvers/UomResolver.js'

const STRIP_KEYS = new Set([
	'accountId',
	'files',
	'group',
	'id',
	'owner',
	'syncId',
])

const ALLOWED_META_PATHS = new Set([
	'buyPrice.currency.meta',
	'country.meta',
	'productFolder.meta',
	'salePrices.*.priceType.meta',
	'taxRate.meta',
	'uom.meta',
])

function cloneValue(value) {
	if (typeof structuredClone === 'function') {
		return structuredClone(value)
	}

	return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function compactObject(value) {
	if (!isObject(value)) {
		return value
	}

	return Object.keys(value).length > 0 ? value : undefined
}

function getPathKey(path) {
	return path.map(part => (typeof part === 'number' ? '*' : part)).join('.')
}

function toMetaReference(resolved) {
	return resolved?.meta ? { meta: cloneValue(resolved.meta) } : null
}

async function optionalResolve(resolver, source, options = {}) {
	if (!source) {
		return null
	}

	try {
		return toMetaReference(await resolver.resolve(source, options))
	} catch {
		return null
	}
}

async function optionalResolveCurrency(resolver, source) {
	if (!source) {
		return null
	}

	const resolved =
		typeof resolver.resolveOrDefault === 'function'
			? await resolver.resolveOrDefault(source)
			: await resolver.resolve(source)
	return toMetaReference(resolved)
}

function copyBusinessFields(product) {
	const payload = {}
	const fields = [
		'name',
		'code',
		'article',
		'externalCode',
		'description',
		'archived',
		'vat',
		'weight',
		'volume',
		'barcodes',
		'characteristics',
	]

	for (const field of fields) {
		if (product[field] !== undefined) {
			payload[field] = cloneValue(product[field])
		}
	}

	return payload
}

async function mapBuyPrice(buyPrice, resolver) {
	if (!isObject(buyPrice)) {
		return buyPrice
	}

	const mappedBuyPrice = cloneValue(buyPrice)
	if (buyPrice.currency) {
		const currency = await optionalResolveCurrency(resolver, buyPrice.currency)
		if (currency) {
			mappedBuyPrice.currency = currency
		} else {
			delete mappedBuyPrice.currency
		}
	}

	return mappedBuyPrice
}

async function mapSalePrices(salePrices, resolver) {
	if (!Array.isArray(salePrices)) {
		return undefined
	}

	const mappedSalePrices = []
	for (const salePrice of salePrices) {
		const priceType = await optionalResolve(
			resolver,
			salePrice.priceType,
		)
		if (!priceType) {
			continue
		}

		const mappedSalePrice = cloneValue(salePrice)
		mappedSalePrice.priceType = priceType
		mappedSalePrices.push(mappedSalePrice)
	}

	return mappedSalePrices
}

function findTaxSource(product) {
	return product.taxRate || product.tax || product.vatRate || null
}

function collectAllowedMetaHrefs(value, path = [], hrefs = new Set()) {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			collectAllowedMetaHrefs(value[index], [...path, index], hrefs)
		}
		return hrefs
	}

	if (!isObject(value)) {
		return hrefs
	}

	if (
		ALLOWED_META_PATHS.has(getPathKey(path)) &&
		typeof value.href === 'string'
	) {
		hrefs.add(value.href)
	}

	for (const [key, child] of Object.entries(value)) {
		collectAllowedMetaHrefs(child, [...path, key], hrefs)
	}

	return hrefs
}

function sanitizePayload(value, allowedMetaHrefs, path = []) {
	if (Array.isArray(value)) {
		return value
			.map((item, index) => sanitizePayload(item, allowedMetaHrefs, [...path, index]))
			.filter(item => item !== undefined)
	}

	if (!isObject(value)) {
		return value
	}

	const pathKey = getPathKey(path)
	if (path.at(-1) === 'meta') {
		if (
			!ALLOWED_META_PATHS.has(pathKey) ||
			!allowedMetaHrefs.has(value.href)
		) {
			return undefined
		}

		return {
			href: value.href,
			type: value.type,
			mediaType: value.mediaType,
		}
	}

	const sanitized = {}
	for (const [key, childValue] of Object.entries(value)) {
		if (STRIP_KEYS.has(key)) {
			continue
		}

		const sanitizedChild = sanitizePayload(childValue, allowedMetaHrefs, [
			...path,
			key,
		])
		if (sanitizedChild !== undefined) {
			sanitized[key] = sanitizedChild
		}
	}

	return compactObject(sanitized)
}

export class ProductMapper {
	constructor({
		currency = currencyResolver,
		priceType = priceTypeResolver,
		uom = uomResolver,
		country = countryResolver,
		tax = taxResolver,
		productFolder = productFolderResolver,
	} = {}) {
		this.currencyResolver = currency
		this.priceTypeResolver = priceType
		this.uomResolver = uom
		this.countryResolver = country
		this.taxResolver = tax
		this.productFolderResolver = productFolder
	}

	async map(product) {
		if (!isObject(product)) {
			throw new Error('Product payload is required')
		}

		const payload = copyBusinessFields(product)

		if (product.buyPrice !== undefined) {
			payload.buyPrice = await mapBuyPrice(
				product.buyPrice,
				this.currencyResolver,
			)
		}

		if (product.salePrices !== undefined) {
			payload.salePrices = await mapSalePrices(
				product.salePrices,
				this.priceTypeResolver,
			)
		}

		const uom = await optionalResolve(this.uomResolver, product.uom)
		if (uom) {
			payload.uom = uom
		}

		const productFolder = await optionalResolve(
			this.productFolderResolver,
			product.productFolder || product.folder,
		)
		if (productFolder) {
			payload.productFolder = productFolder
		}

		const country = await optionalResolve(this.countryResolver, product.country)
		if (country) {
			payload.country = country
		}

		const taxRate = await optionalResolve(this.taxResolver, findTaxSource(product))
		if (taxRate) {
			payload.taxRate = taxRate
		}

		const allowedMetaHrefs = collectAllowedMetaHrefs(payload)
		return sanitizePayload(payload, allowedMetaHrefs) || {}
	}

	mapMany(products) {
		return Promise.all(products.map(product => this.map(product)))
	}
}

export const productMapper = new ProductMapper()

export default productMapper
