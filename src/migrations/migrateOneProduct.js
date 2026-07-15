import { productMapper } from '../mappers/productMapper.js'
import { productRepository } from '../repositories/productRepository.js'
import { validateProductPayload } from '../validators/productValidator.js'

function getProductLabel(product) {
	return product?.name || product?.code || product?.externalCode || product?.id || ''
}

async function findExistingProduct(product, repository) {
	if (product.externalCode) {
		const existingProduct = await repository.findByExternalCode(
			product.externalCode,
			{ client: 'new' },
		)
		if (existingProduct) {
			return existingProduct
		}
	}

	if (product.code && product.name) {
		const existingProduct = await repository.findByCode(product.code, {
			client: 'new',
		})
		if (existingProduct?.name === product.name) {
			return existingProduct
		}
	}

	if (product.name) {
		return repository.findByName(product.name, { client: 'new' })
	}

	return null
}

export async function migrateOneProduct(
	oldProductId,
	{
		dryRun = true,
		productRepository: productRepositoryInstance = productRepository,
		productMapper: productMapperInstance = productMapper,
		validator = validateProductPayload,
	} = {},
) {
	if (!oldProductId) {
		throw new Error('Product ID is required')
	}

	const oldProduct = await productRepositoryInstance.findById(oldProductId, {
		client: 'old',
	})
	const payload = await productMapperInstance.map(oldProduct)
	validator(payload)

	const existingProduct = await findExistingProduct(
		payload,
		productRepositoryInstance,
	)
	if (existingProduct) {
		console.log(`SKIPPED: Product already exists: ${getProductLabel(payload)}`)
		return {
			success: true,
			skipped: true,
			created: false,
			productName: payload.name,
			oldProductId,
			newProductId: existingProduct.id,
		}
	}

	if (dryRun) {
		return {
			success: true,
			skipped: false,
			created: false,
			dryRun: true,
			productName: payload.name,
			oldProductId,
			newProductId: null,
		}
	}

	const createdProduct = await productRepositoryInstance.create(payload, {
		client: 'new',
	})

	return {
		success: true,
		skipped: false,
		created: true,
		productName: payload.name,
		oldProductId,
		newProductId: createdProduct?.id || createdProduct?.meta?.href || null,
	}
}

export default migrateOneProduct
