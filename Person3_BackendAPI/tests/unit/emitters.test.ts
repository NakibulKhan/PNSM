jest.mock('@/services/socket/socketServer', () => ({
  getSocketServer: jest.fn(),
  isSocketServerInitialized: jest.fn(),
}));

import { emitAttendanceNew, emitAttendanceFlagged, emitSpoofAlert, emitNotificationNew } from '@/services/socket/emitters';
import { getSocketServer, isSocketServerInitialized } from '@/services/socket/socketServer';
import { SOCKET_EVENTS } from '@/constants';

const mockedGetSocketServer = getSocketServer as jest.Mock;
const mockedIsInitialized = isSocketServerInitialized as jest.Mock;

describe('socket emitters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('drops the event without throwing when the socket server is not initialized', () => {
    mockedIsInitialized.mockReturnValue(false);
    expect(() => emitAttendanceNew({ _id: 'log-1' })).not.toThrow();
    expect(mockedGetSocketServer).not.toHaveBeenCalled();
  });

  it('throws rather than silently emitting a payload with no _id (admin client dedupes on it)', () => {
    mockedIsInitialized.mockReturnValue(true);
    const emit = jest.fn();
    mockedGetSocketServer.mockReturnValue({ emit });
    expect(() => emitAttendanceNew({ employee_name: 'Rafiq' })).toThrow(/missing _id/);
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits attendance:new with the full payload when initialized', () => {
    mockedIsInitialized.mockReturnValue(true);
    const emit = jest.fn();
    mockedGetSocketServer.mockReturnValue({ emit });

    const log = { _id: 'log-1', status: 'approved' };
    emitAttendanceNew(log);

    expect(emit).toHaveBeenCalledWith(SOCKET_EVENTS.attendanceNew, log);
  });

  it('emits attendance:flagged, spoof:alert, and notification:new on their respective event names', () => {
    mockedIsInitialized.mockReturnValue(true);
    const emit = jest.fn();
    mockedGetSocketServer.mockReturnValue({ emit });

    emitAttendanceFlagged({ _id: 'log-2' });
    emitSpoofAlert({ _id: 'alert-1' });
    emitNotificationNew({ _id: 'notif-1' });

    expect(emit).toHaveBeenNthCalledWith(1, SOCKET_EVENTS.attendanceFlagged, { _id: 'log-2' });
    expect(emit).toHaveBeenNthCalledWith(2, SOCKET_EVENTS.spoofAlert, { _id: 'alert-1' });
    expect(emit).toHaveBeenNthCalledWith(3, SOCKET_EVENTS.notificationNew, { _id: 'notif-1' });
  });
});
