import { employeeResolver } from '../resolvers/EmployeeResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import { warehouseResolver } from '../resolvers/WarehouseResolver.js'
import {
	copyScalarFields,
	getRows,
	inventoryAttributeResolver,
	inventoryStateResolver,
	isObject,
	mapAssortmentPosition,
	mapAttributes,
	removeUndefined,
	resolveOptionalReference,
	resolveRequiredReference,
} from './purchaseChainMapperUtils.js'

const SCALAR_FIELDS = [
	'moment',
	'applicable',
	'description',
	'externalCode',
]

async function mapInventoryPosition(position, inventory) {
	return mapAssortmentPosition(position, inventory)
}

export class InventoryMapper {
	async map(inventory) {
		if (!isObject(inventory)) {
			throw new Error('Inventory payload is required')
		}

		const payload = {}
		copyScalarFields(payload, inventory, SCALAR_FIELDS)

		payload.organization = await resolveRequiredReference(
			inventory.organization,
			organizationResolver,
			'Inventory organization',
			'Organization not found',
		)
		payload.store = await resolveRequiredReference(
			inventory.store,
			warehouseResolver,
			'Inventory warehouse',
			'Warehouse not found',
		)

		const owner = await resolveOptionalReference(
			inventory.owner,
			employeeResolver,
			'Owner',
			'Owner not found',
		)
		if (owner) {
			payload.owner = owner
		}

		const project = await resolveOptionalReference(
			inventory.project,
			projectResolver,
			'Project',
			'Project not found',
		)
		if (project) {
			payload.project = project
		}

		const state = await resolveOptionalReference(
			inventory.state,
			inventoryStateResolver,
			'State',
		)
		if (state) {
			payload.state = state
		}

		const attributes = await mapAttributes(
			inventory.attributes,
			inventoryAttributeResolver,
		)
		if (attributes) {
			payload.attributes = attributes
		}

		payload.positions = await Promise.all(
			getRows(inventory.positions).map(position =>
				mapInventoryPosition(position, inventory),
			),
		)

		return removeUndefined(payload) || {}
	}
}

export const inventoryMapper = new InventoryMapper()

export default inventoryMapper
