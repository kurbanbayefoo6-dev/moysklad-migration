import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'

const ATTRIBUTES_ENDPOINT = 'entity/demand/metadata/attributes'

function normalizeItems(response) {
	if (Array.isArray(response?.rows)) {
		return response.rows
	}

	return Array.isArray(response) ? response : []
}

function getReferenceHref(source) {
	return source?.meta?.href || source?.href || ''
}

function getReferenceId(source) {
	const href = getReferenceHref(source)
	return source?.id || href.split('/').filter(Boolean).at(-1) || ''
}

function extractMeta(entity) {
	return entity?.meta
		? {
				href: entity.meta.href,
				type: entity.meta.type,
				mediaType: entity.meta.mediaType,
			}
		: null
}

export class ShipmentAttributeResolver {
	constructor({
		oldAttributeClient = oldClient,
		newAttributeClient = newClient,
	} = {}) {
		this.oldAttributeClient = oldAttributeClient
		this.newAttributeClient = newAttributeClient
		this.oldAttributes = null
		this.newAttributes = null
	}

	async loadAttributes(client) {
		return normalizeItems(await client.get(ATTRIBUTES_ENDPOINT))
	}

	async getOldAttributes() {
		if (!this.oldAttributes) {
			this.oldAttributes = await this.loadAttributes(this.oldAttributeClient)
		}

		return this.oldAttributes
	}

	async getNewAttributes() {
		if (!this.newAttributes) {
			this.newAttributes = await this.loadAttributes(this.newAttributeClient)
		}

		return this.newAttributes
	}

	async resolve(source) {
		const oldAttributes = await this.getOldAttributes()
		const sourceHref = getReferenceHref(source)
		const sourceId = getReferenceId(source)
		const oldAttribute =
			oldAttributes.find(attribute => sourceHref && attribute?.meta?.href === sourceHref) ||
			oldAttributes.find(attribute => sourceId && attribute?.id === sourceId) ||
			oldAttributes.find(attribute => source?.name && attribute?.name === source.name)

		if (!oldAttribute?.name) {
			return null
		}

		const newAttributes = await this.getNewAttributes()
		const newAttribute = newAttributes.find(
			attribute => attribute?.name === oldAttribute.name,
		)
		const meta = extractMeta(newAttribute)
		return meta ? { meta } : null
	}
}

export const shipmentAttributeResolver = new ShipmentAttributeResolver()

export default shipmentAttributeResolver
