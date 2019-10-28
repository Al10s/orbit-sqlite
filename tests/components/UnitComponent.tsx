import React from 'react';
import { RunnableTestUnit, TestContext, getFormattedDuration } from '../utils';
import { View, Text } from 'react-native';
import styles from '../styles';
import moment from 'moment';

export interface Props {
  test: RunnableTestUnit<TestContext>;
  beforeEach: () => Promise<TestContext>;
  afterEach: (t: TestContext) => Promise<void>;
}

export type Status = 'pending'|'processing'|'success'|'failure';

interface State {
  status: Status;
  result: string;
  duration: string;
}

export default class UnitComponent extends React.Component<Props, State> {
  constructor (props: Props) {
    super(props);
    this.state = {
      status: 'pending',
      result: '',
      duration: '',
    };
  }

  async componentDidMount () {
    this.setState({ status: 'processing' });
    const context = await this.props.beforeEach()
    const start = moment();
    try {
      await this.props.test.run(context)
      this.props.test.emitter.trigger('success');
      this.setState({ status: 'success', result: 'PASSED' })
    }
    catch (error) {
      this.props.test.emitter.trigger('failure', { error });
      this.setState({ status: 'failure', result: error.message });
    }
    this.setState({ duration: getFormattedDuration(start, moment()) })
    await this.props.afterEach(context);
    this.props.test.emitter.trigger('done')
  }

  render = () => {
    const rowStyle = (this.state.status === 'pending' ? styles.pending :
      (this.state.status === 'processing' ? styles.processing :
        (this.state.status === 'success' ? styles.success :
          styles.failure
        )
      )
    );
    return (
      <View
        style={{
          ...styles.row,
          ...styles.content_row,
          ...rowStyle
        }}
        >
        <Text style={{ ...styles.cell, ...styles.content_cell, ...styles.label_cell }}>{this.props.test.label}</Text>
        <Text style={{ ...styles.cell, ...styles.content_cell, ...styles.result_cell }}>{this.state.result}</Text>
        <Text style={{ ...styles.cell, ...styles.content_cell, ...styles.duration_cell }}>{this.state.duration}</Text>
      </View>
    );
  }
}