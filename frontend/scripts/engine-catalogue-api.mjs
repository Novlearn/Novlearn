// Root migration scripts consume only the package's declared public exports.
export {adaptLegacyExercise} from 'novlearn-exercise-engine/legacy';
export {validateDefinition,instantiateExercise,projectPublicInstance,gradeAnswer} from 'novlearn-exercise-engine';
