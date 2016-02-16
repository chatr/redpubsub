RPS._containsOperators = function (modifier) {
    return _.some(modifier, function (value, operator) {
        return /^\$/.test(operator);
    });
};

RPS._containsOnlySetters = function (modifier) {
    return !_.difference(_.keys(modifier), ['$set', '$unset']).length;
};

RPS._isSimpleModifier = function (modifier) {
    return !RPS._containsOperators(modifier) || RPS._containsOnlySetters(modifier);
};