import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes CSV and guards text formula injection only', () => {
    expect(
      toCsv(
        ['email', 'amount'],
        [
          ['a,"b\nc', -1],
          ['=HYPERLINK("x")', null],
        ],
      ),
    ).toBe(
      '\uFEFF"email","amount"\r\n"a,""b\nc","-1"\r\n"\'=HYPERLINK(""x"")",""\r\n',
    );
  });

  it('guards a leading line feed', () => {
    expect(toCsv(['email'], [['\n=1+1']])).toBe(
      '﻿"email"\r\n"\'\n=1+1"\r\n',
    );
  });
});
