RPS._containsOperators = function (modifier) {
    return _.some(modifier, function (value, operator) {
        return /^\$/.test(operator);
    });
};

RPS._containsOnlySetters = function (modifier) {
    return !_.difference(_.keys(modifier), ['$set', '$unset']).length && '_containsOnlySetters';
};

RPS._isSimpleModifier = function (modifier) {
    return (!RPS._containsOperators(modifier) && 'NO_OPERATORS') || (RPS._containsOnlySetters(modifier) && 'ONLY_SETTERS');
};