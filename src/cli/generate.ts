import { DatabaseConnection } from '../config/database.js';
import { SchemaIntrospector } from '../introspector/schema-introspector.js';
import {
  CodeGenerator,
  GeneratorOptions,
} from '../generator/code-generator.js';
import { TypeMapper } from '../mapper/type-mapper.js';

export async function generateCodeFromDatabase(
  connectionConfig: any,
  generatorOptions: any
): Promise<void> {
  const dbConnection = new DatabaseConnection(connectionConfig);
  const introspector = new SchemaIntrospector(dbConnection);
  const typeMapper = new TypeMapper();
  const codeGenerator = new CodeGenerator(generatorOptions, typeMapper);

  try {
    console.log('Testing database connection...');
    if (await dbConnection.testConnection()) {
      console.log('Connection successful!');

      console.log('Introspecting database schema...');
      const schema = await introspector.introspectSchema();

      console.log('Generating code...');
      await codeGenerator.generateFromSchema(schema);

      console.log('Code generation complete!');
    } else {
      console.error('Failed to connect to the database.');
    }
  } catch (error) {
    console.error('Error during code generation:', error);
  } finally {
    await dbConnection.close();
  }
}
