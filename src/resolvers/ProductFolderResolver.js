import { BaseRepository } from '../repositories/baseRepository.js'
import { BaseResolver } from './BaseResolver.js'

function getFolderPath(source) {
	const pathName = source?.pathName || ''
	const name = source?.name || ''
	return pathName ? `${pathName}/${name}` : name
}

export class ProductFolderResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'ProductFolder',
			repository:
				options.repository ||
				new BaseRepository({
					endpoint: 'entity/productfolder',
				}),
			client: options.client || 'new',
			strategies: [
				{ name: 'path', getValue: source => getFolderPath(source), method: 'findByName' },
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
	}

	getEntityFieldValue(entity, strategy) {
		if (strategy.name === 'path') {
			return getFolderPath(entity)
		}

		return super.getEntityFieldValue(entity, strategy)
	}
}

export const productFolderResolver = new ProductFolderResolver()

export default productFolderResolver
