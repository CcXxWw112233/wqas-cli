const { request } = require('@wqas-cli/utils');
console.log(1)
module.exports = function() {
  return request({
    url: '/project/template',
  });
};
